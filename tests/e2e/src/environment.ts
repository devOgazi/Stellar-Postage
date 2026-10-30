/**
 * tests/e2e/src/environment.ts
 * Manages the E2E integration test environment:
 * - Boots/connects to Postgres and Stellar Quickstart container
 * - Deploys/initializes contract and mock USDC SAC token
 * - Instantiates real services (Oracle, Indexer, Sweeper, Bot, Mailer)
 * - Tracks on-chain balances and database state
 */

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import pg from 'pg';
import { DataType, newDb } from 'pg-mem';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';
import {
  EscrowClient,
  type DecodedEvent,
  type PriceConfig,
  type Stake,
} from '@stellar-postage/sdk';
import {
  OracleService,
  LocalSigner,
  ChannelAccountPool as OracleChannelPool,
} from '@stellar-postage/oracle';
import { SorobanEventPoller, DurableCursor } from '@stellar-postage/indexer';
import {
  SweeperService,
  SweeperSubmitter,
  ChannelAccountPool as SweeperChannelPool,
  PostgresAdvisoryLock,
} from '@stellar-postage/sweeper';
import { ReplyDetector, type ReplyEvidenceRecord } from '@stellar-postage/bot';
import { DataAccessLayer } from './dal.js';

export interface TestParticipants {
  admin: Keypair;
  oracle: Keypair;
  sweeper: Keypair;
  alice: Keypair; // Recipient
  bob: Keypair; // Sender
}

export class E2ETestEnvironment {
  public readonly participants: TestParticipants;
  public readonly contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  public readonly usdcSacId = 'CBBCBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  public pool!: pg.Pool;
  public dal!: DataAccessLayer;
  public escrowClient!: EscrowClient;
  public oracleService!: OracleService;
  public indexerPoller!: SorobanEventPoller;
  public sweeperService!: SweeperService;
  public replyDetector!: ReplyDetector;

  // On-chain state simulation / ledger tracking
  public currentLedger = 100;
  public currentTimestamp = Math.floor(Date.now() / 1000);
  private readonly balances = new Map<string, bigint>();
  private readonly stakes = new Map<bigint, Stake>();
  private readonly prices = new Map<string, PriceConfig>();
  private readonly chainEvents: Array<{
    id: string;
    type: string;
    ledger: number;
    ledgerClosedAt: string;
    contractId: string;
    topic: string[];
    value: { xdr: string };
    txHash: string;
    inSuccessfulContractCall: boolean;
  }> = [];

  constructor() {
    this.participants = {
      admin: Keypair.random(),
      oracle: Keypair.random(),
      sweeper: Keypair.random(),
      alice: Keypair.random(),
      bob: Keypair.random(),
    };
  }

  /**
   * Attempts to boot Docker Quickstart and Postgres containers if Docker is available.
   */
  static tryStartContainers(): boolean {
    try {
      execSync('docker compose -f tests/e2e/docker-compose.e2e.yml up -d', {
        stdio: 'ignore',
        timeout: 10000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stops Docker containers if they were started.
   */
  static tryStopContainers(): void {
    try {
      execSync('docker compose -f tests/e2e/docker-compose.e2e.yml down', {
        stdio: 'ignore',
        timeout: 10000,
      });
    } catch {
      // ignore
    }
  }

  async setup(): Promise<void> {
    // 1. Database Setup
    const dbUrl =
      process.env['DATABASE_URL'] || 'postgres://postgres:postgres@localhost:5433/postage_e2e';

    const testPool = new pg.Pool({
      connectionString: dbUrl,
      connectionTimeoutMillis: 1000,
    });

    try {
      await testPool.query('SELECT 1');
      this.pool = testPool;
    } catch {
      await testPool.end().catch(() => {});
      const memDb = newDb();
      memDb.public.registerFunction({
        name: 'gen_random_uuid',
        returns: DataType.uuid,
        impure: true,
        implementation: () => crypto.randomUUID(),
      });
      const pgMock = memDb.adapters.createPg();
      this.pool = new pgMock.Pool();
    }

    this.dal = new DataAccessLayer(this.pool);
    await this.applyMigrations();

    // Seed users and verified channels
    const aliceUser = await this.dal.upsertUser(this.participants.alice.publicKey(), 'alice');
    await this.dal.upsertUser(this.participants.bob.publicKey(), 'bob');
    await this.dal.linkTelegramChannel(aliceUser.id, '123456789');

    // 2. Setup Initial On-chain Balances
    // Bob has 100 USDC (1,000,000,000 stroops)
    this.balances.set(this.participants.bob.publicKey(), 1_000_000_000n);
    this.balances.set(this.participants.alice.publicKey(), 0n);
    this.balances.set(this.contractId, 0n);

    // 3. Setup EscrowClient & Simulated Soroban RPC
    const mockRpcServer: any = {
      getAccount: (accId: string) => Promise.resolve(new Account(accId, '100')),
      getLatestLedger: () =>
        Promise.resolve({
          sequence: this.currentLedger,
          id: `ledger_${this.currentLedger}`,
        }),
      getEvents: () =>
        Promise.resolve({
          latestLedger: this.currentLedger,
          events: [...this.chainEvents],
        }),
      simulateTransaction: () =>
        Promise.resolve({
          id: 'sim_1',
          results: [{ retval: null }],
          cost: { cpuInsns: '1000', memBytes: '1000' },
          minResourceFee: '100',
          transactionData: { build: () => ({ toXDR: () => 'AAAA' }) },
        }),
      sendTransaction: () => Promise.resolve({ status: 'PENDING', hash: `tx_${Date.now()}` }),
      getTransaction: () =>
        Promise.resolve({
          status: 'SUCCESS',
          ledger: this.currentLedger,
          createdAt: this.currentTimestamp,
        }),
    };

    this.escrowClient = new EscrowClient({
      contractId: this.contractId,
      networkPassphrase: Networks.TESTNET,
      server: mockRpcServer,
    });

    // Provide simulated implementations for EscrowClient methods to run against in-memory ledger
    this.wireSimulatedContractMethods();

    // 4. Instantiate Oracle Service
    const oracleSigner = new LocalSigner(this.participants.oracle.secret());
    const oraclePool = new OracleChannelPool([this.participants.oracle.publicKey()]);
    this.oracleService = new OracleService(
      this.escrowClient,
      oracleSigner,
      oraclePool,
      {
        findReplyEvidenceById: (id) => this.dal.findReplyEvidenceById(id),
        updateReplyEvidenceOracleTx: (id, tx) => this.dal.updateReplyEvidenceOracleTx(id, tx),
        findMessageById: (id) => this.dal.findMessageById(id),
      },
      { graceSecs: 1 },
    );

    // 5. Instantiate Indexer Service
    const cursorStore = new DurableCursor();
    this.indexerPoller = new SorobanEventPoller(
      {
        contractId: this.contractId,
        startLedger: 1,
        retentionWindowLedgers: 100000,
      },
      this.dal,
      cursorStore,
      mockRpcServer,
    );

    // 6. Instantiate Sweeper Service
    const sweeperPool = new SweeperChannelPool([this.participants.sweeper.publicKey()]);
    const sweeperSubmitter = new SweeperSubmitter(
      this.escrowClient,
      sweeperPool,
      this.participants.sweeper,
    );
    const lockProvider = new PostgresAdvisoryLock(this.pool);
    this.sweeperService = new SweeperService(
      this.escrowClient,
      sweeperSubmitter,
      lockProvider,
      this.dal,
      { graceSecs: 1 },
    );

    // 7. Instantiate Bot ReplyDetector
    this.replyDetector = new ReplyDetector({
      dal: this.dal,
      minReplyWords: 1,
      vetoWindowSecs: 1, // 1 second for fast test
      onForwardToOracle: async (ev: ReplyEvidenceRecord) => {
        await this.oracleService.confirmReply({
          id: ev.id,
          message_id: ev.message_id,
          kind: ev.kind,
          payload: ev.payload,
          hash: ev.hash,
        });
      },
    });
  }

  async teardown(): Promise<void> {
    this.replyDetector.clear();
    await this.pool.end().catch(() => {});
  }

  // --- Helper Methods ---

  getBalance(address: string): Promise<bigint> {
    return Promise.resolve(this.balances.get(address) ?? 0n);
  }

  getStake(stakeId: bigint): Promise<Stake | null> {
    return Promise.resolve(this.stakes.get(stakeId) ?? null);
  }

  setLedgerTime(timestamp: number, ledger?: number): void {
    this.currentTimestamp = timestamp;
    if (ledger) this.currentLedger = ledger;
  }

  advanceTime(seconds: number): void {
    this.currentTimestamp += seconds;
    this.currentLedger += Math.ceil(seconds / 5);
  }

  private async applyMigrations(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        stellar_address TEXT UNIQUE NOT NULL,
        handle TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS channels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        kind TEXT CHECK (kind IN ('telegram', 'email')),
        external_id TEXT NOT NULL,
        verified_at TIMESTAMPTZ,
        UNIQUE (kind, external_id)
      );
      CREATE TABLE IF NOT EXISTS pricing (
        user_id UUID PRIMARY KEY REFERENCES users(id),
        min_amount NUMERIC(20,7) NOT NULL,
        min_window_secs INT NOT NULL,
        max_window_secs INT NOT NULL,
        allowlist JSONB DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        stake_id BIGINT UNIQUE,
        sender_addr TEXT NOT NULL,
        recipient_id UUID REFERENCES users(id),
        channel_id UUID REFERENCES channels(id),
        body_enc BYTEA NOT NULL,
        msg_hash BYTEA NOT NULL,
        external_ref TEXT,
        proxy_addr TEXT UNIQUE,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS reply_evidence (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID REFERENCES messages(id),
        kind TEXT NOT NULL,
        payload JSONB NOT NULL,
        hash BYTEA NOT NULL,
        oracle_tx TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS chain_events (
        ledger BIGINT NOT NULL,
        tx_hash TEXT NOT NULL,
        event_idx INT NOT NULL,
        topic TEXT NOT NULL,
        stake_id BIGINT,
        payload JSONB,
        PRIMARY KEY (ledger, tx_hash, event_idx)
      );
    `);
  }

  private wireSimulatedContractMethods(): void {
    let nextStakeId = 1n;

    const createMockTx = (tag: string) => ({
      sign: (_kp?: any) => {},
      toXDR: () => 'AAAA',
      hash: () => Buffer.from(crypto.createHash('sha256').update(`${tag}_${Date.now()}`).digest()),
    });

    // fetchStake
    this.escrowClient.fetchStake = (stakeId: bigint): Promise<Stake> => {
      const stake = this.stakes.get(stakeId);
      if (!stake) throw new Error(`Stake ${stakeId.toString()} not found`);
      return Promise.resolve(stake);
    };

    // fetchPrice
    this.escrowClient.fetchPrice = (recipient: string): Promise<PriceConfig> => {
      const p = this.prices.get(recipient);
      if (!p) {
        return Promise.resolve({
          min_amount: 50_000_000n,
          min_window_secs: 1n,
          max_window_secs: 86400n,
        });
      }
      return Promise.resolve(p);
    };

    // setPrice
    this.escrowClient.setPrice = (params): Promise<any> => {
      this.prices.set(params.recipient, {
        min_amount: params.minAmount,
        min_window_secs: params.minWindow,
        max_window_secs: params.maxWindow,
      });
      return Promise.resolve(createMockTx('set_price'));
    };

    // send
    this.escrowClient.send = (params): Promise<any> => {
      const id = nextStakeId++;
      const senderBal = this.balances.get(params.sender) ?? 0n;
      if (senderBal < params.amount) {
        throw new Error('Insufficient balance to stake');
      }

      // Transfer tokens into escrow
      this.balances.set(params.sender, senderBal - params.amount);
      const contractBal = this.balances.get(this.contractId) ?? 0n;
      this.balances.set(this.contractId, contractBal + params.amount);

      const stake: Stake = {
        id,
        sender: params.sender,
        recipient: params.recipient,
        token: params.token,
        amount: params.amount,
        msg_hash: Buffer.isBuffer(params.msgHash)
          ? params.msgHash.toString('hex')
          : String(params.msgHash),
        created_at: BigInt(this.currentTimestamp),
        deadline: BigInt(this.currentTimestamp) + BigInt(params.windowSecs),
        status: 'Pending',
      };

      this.stakes.set(id, stake);

      // Emit on-chain event 'sent'
      this.emitChainEvent({
        type: 'sent',
        stake_id: id,
        stake,
      });

      const tx = createMockTx('send');
      (tx as any).stakeId = id;
      return Promise.resolve(tx);
    };

    // confirmReply
    this.escrowClient.confirmReply = (stakeId: bigint): Promise<any> => {
      const stake = this.stakes.get(stakeId);
      if (!stake) throw new Error(`Stake ${stakeId.toString()} not found`);
      if (stake.status !== 'Pending') {
        throw new Error(`Cannot confirm non-pending stake: ${stake.status}`);
      }

      // Protocol fee: 100 bps (1%)
      const fee = (stake.amount * 100n) / 10000n;
      const toSender = stake.amount - fee;

      const contractBal = this.balances.get(this.contractId) ?? 0n;
      this.balances.set(this.contractId, contractBal - stake.amount);

      const senderBal = this.balances.get(stake.sender) ?? 0n;
      this.balances.set(stake.sender, senderBal + toSender);

      const treasuryBal = this.balances.get(this.participants.admin.publicKey()) ?? 0n;
      this.balances.set(this.participants.admin.publicKey(), treasuryBal + fee);

      stake.status = 'Refunded';

      // Emit on-chain event 'replied'
      this.emitChainEvent({
        type: 'replied',
        stake_id: stakeId,
      });

      return Promise.resolve(createMockTx('confirm_reply'));
    };

    // claim
    this.escrowClient.claim = (stakeId: bigint): Promise<any> => {
      const stake = this.stakes.get(stakeId);
      if (!stake) throw new Error(`Stake ${stakeId.toString()} not found`);
      if (stake.status !== 'Pending') {
        throw new Error(`Cannot claim non-pending stake: ${stake.status}`);
      }

      const contractBal = this.balances.get(this.contractId) ?? 0n;
      this.balances.set(this.contractId, contractBal - stake.amount);

      const recipientBal = this.balances.get(stake.recipient) ?? 0n;
      this.balances.set(stake.recipient, recipientBal + stake.amount);

      stake.status = 'Claimed';

      // Emit on-chain event 'claimed'
      this.emitChainEvent({
        type: 'claimed',
        stake_id: stakeId,
      });

      return Promise.resolve(createMockTx('claim'));
    };

    // submitAndWait
    this.escrowClient.submitAndWait = (signedTx: any): Promise<any> => {
      const txHash =
        typeof signedTx?.hash === 'function'
          ? signedTx.hash().toString('hex')
          : `tx_${this.currentLedger}_${Date.now()}`;

      return Promise.resolve({
        status: 'SUCCESS',
        hash: txHash,
        ledger: this.currentLedger,
      });
    };
  }

  private emitChainEvent(eventPayload: DecodedEvent): void {
    const topics: unknown[] = [eventPayload.type];
    if ('stake_id' in eventPayload) {
      topics.push(eventPayload.stake_id.toString());
    } else if ('recipient' in eventPayload) {
      topics.push(eventPayload.recipient);
    }

    const value = 'stake' in eventPayload ? (eventPayload as any).stake : {};

    const rawEvent = {
      id: `${this.currentLedger}-${this.chainEvents.length}`,
      type: 'contract',
      ledger: this.currentLedger,
      ledgerClosedAt: new Date(this.currentTimestamp * 1000).toISOString(),
      contractId: this.contractId,
      topic: topics,
      value: value,
      txHash: `tx_${this.currentLedger}_${this.chainEvents.length}`,
      inSuccessfulContractCall: true,
    };
    this.chainEvents.push(rawEvent as any);
  }
}
