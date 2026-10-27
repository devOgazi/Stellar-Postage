/**
 * packages/sdk/src/client.ts
 * Typed TypeScript client for the Stellar Postage Soroban escrow contract.
 */

import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { parseContractError } from './errors.js';
import type { PriceConfig, SendParams, SetPriceParams, Stake } from './types.js';

export interface EscrowClientConfig {
  contractId: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  server?: rpc.Server;
  defaultCaller?: string;
}

export interface SubmitOptions {
  timeoutSecs?: number;
  pollIntervalMs?: number;
}

export class EscrowClient {
  readonly contractId: string;
  readonly contract: Contract;
  readonly server: rpc.Server;
  readonly networkPassphrase: string;
  readonly defaultCaller: string | undefined;

  constructor(config: EscrowClientConfig) {
    this.contractId = config.contractId;
    this.contract = new Contract(config.contractId);
    this.networkPassphrase =
      config.networkPassphrase ?? 'Test SDF Network ; September 2015';
    this.defaultCaller = config.defaultCaller;

    if (config.server) {
      this.server = config.server;
    } else {
      const url = config.rpcUrl ?? 'https://soroban-testnet.stellar.org';
      this.server = new rpc.Server(url);
    }
  }

  // ---------------------------------------------------------------------------
  // Transaction preparation helper
  // ---------------------------------------------------------------------------

  private async prepareTransaction(
    functionName: string,
    args: xdr.ScVal[],
    caller?: string
  ): Promise<Transaction> {
    const source = caller || this.defaultCaller;
    if (!source) {
      throw new Error(
        `Source account is required to build transaction for '${functionName}'. Pass caller or configure defaultCaller.`
      );
    }

    const account = await this.server.getAccount(source);
    const op = this.contract.call(functionName, ...args);

    const rawTx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(rawTx);

    if (rpc.Api.isSimulationError(sim)) {
      const parsedErr = parseContractError(sim);
      if (parsedErr) {
        throw parsedErr;
      }
      throw new Error(`Simulation failed for '${functionName}': ${sim.error}`);
    }

    const assembled = rpc.assembleTransaction(rawTx, sim).build();
    return assembled;
  }

  private encodeMsgHash(msgHash: string | Buffer | Uint8Array): xdr.ScVal {
    let buf: Buffer;
    if (typeof msgHash === 'string') {
      const clean = msgHash.startsWith('0x') ? msgHash.slice(2) : msgHash;
      buf = Buffer.from(clean, 'hex');
    } else {
      buf = Buffer.from(msgHash);
    }
    if (buf.length !== 32) {
      throw new Error(`msg_hash must be exactly 32 bytes, got ${buf.length}`);
    }
    return xdr.ScVal.scvBytes(buf);
  }

  // ---------------------------------------------------------------------------
  // Contract public methods
  // ---------------------------------------------------------------------------

  /**
   * Recipient sets price and reply window range.
   * README: set_price(recipient, min_amount, min_window, max_window)
   */
  async setPrice(params: SetPriceParams, caller?: string): Promise<Transaction> {
    const args = [
      new Address(params.recipient).toScVal(),
      nativeToScVal(params.minAmount, { type: 'i128' }),
      nativeToScVal(params.minWindow, { type: 'u64' }),
      nativeToScVal(params.maxWindow, { type: 'u64' }),
    ];
    return this.prepareTransaction('set_price', args, caller || params.recipient);
  }

  /**
   * Sender stakes USDC into escrow.
   * README: send(sender, recipient, token, amount, msg_hash, window_secs) -> u64
   */
  async send(params: SendParams, caller?: string): Promise<Transaction> {
    const args = [
      new Address(params.sender).toScVal(),
      new Address(params.recipient).toScVal(),
      new Address(params.token).toScVal(),
      nativeToScVal(params.amount, { type: 'i128' }),
      this.encodeMsgHash(params.msgHash),
      nativeToScVal(params.windowSecs, { type: 'u64' }),
    ];
    return this.prepareTransaction('send', args, caller || params.sender);
  }

  /**
   * Oracle confirms reply by recipient.
   * README: confirm_reply(stake_id)
   */
  async confirmReply(
    stakeId: bigint | number,
    caller?: string
  ): Promise<Transaction> {
    const args = [nativeToScVal(BigInt(stakeId), { type: 'u64' })];
    return this.prepareTransaction('confirm_reply', args, caller);
  }

  /**
   * Recipient flags message as spam for immediate payout.
   * README: flag_spam(stake_id)
   */
  async flagSpam(
    stakeId: bigint | number,
    caller?: string
  ): Promise<Transaction> {
    const args = [nativeToScVal(BigInt(stakeId), { type: 'u64' })];
    return this.prepareTransaction('flag_spam', args, caller);
  }

  /**
   * Anyone claims expired stake after deadline + grace.
   * README: claim(stake_id)
   */
  async claim(
    stakeId: bigint | number,
    caller?: string
  ): Promise<Transaction> {
    const args = [nativeToScVal(BigInt(stakeId), { type: 'u64' })];
    return this.prepareTransaction('claim', args, caller);
  }

  /**
   * Read-only getter for Stake. Returns simulated assembled transaction ready for signing/evaluating.
   * README: get_stake(stake_id) -> Stake
   */
  async getStake(
    stakeId: bigint | number,
    caller?: string
  ): Promise<Transaction> {
    const args = [nativeToScVal(BigInt(stakeId), { type: 'u64' })];
    return this.prepareTransaction('get_stake', args, caller);
  }

  /**
   * Read-only getter for PriceConfig. Returns simulated assembled transaction ready for signing/evaluating.
   * README: get_price(recipient) -> PriceConfig
   */
  async getPrice(recipient: string, caller?: string): Promise<Transaction> {
    const args = [new Address(recipient).toScVal()];
    return this.prepareTransaction('get_price', args, caller);
  }

  /**
   * Anyone extends TTL on an active stake record.
   * README: extend_ttl(stake_id)
   */
  async extendTtl(
    stakeId: bigint | number,
    caller?: string
  ): Promise<Transaction> {
    const args = [nativeToScVal(BigInt(stakeId), { type: 'u64' })];
    return this.prepareTransaction('extend_ttl', args, caller);
  }

  // ---------------------------------------------------------------------------
  // Admin functions
  // ---------------------------------------------------------------------------

  /**
   * Admin rotates oracle address.
   * README: set_oracle(new_oracle)
   */
  async setOracle(newOracle: string, caller?: string): Promise<Transaction> {
    const args = [new Address(newOracle).toScVal()];
    return this.prepareTransaction('set_oracle', args, caller);
  }

  /**
   * Admin updates protocol fee (capped at 500 bps = 5%).
   * README: set_fee(fee_bps)
   */
  async setFee(feeBps: number | bigint, caller?: string): Promise<Transaction> {
    const args = [nativeToScVal(Number(feeBps), { type: 'u32' })];
    return this.prepareTransaction('set_fee', args, caller);
  }

  /**
   * Admin pauses new send calls.
   * README: pause()
   */
  async pause(caller?: string): Promise<Transaction> {
    return this.prepareTransaction('pause', [], caller);
  }

  /**
   * Admin unpauses new send calls.
   * README: unpause()
   */
  async unpause(caller?: string): Promise<Transaction> {
    return this.prepareTransaction('unpause', [], caller);
  }

  // ---------------------------------------------------------------------------
  // Direct query helpers
  // ---------------------------------------------------------------------------

  /**
   * Query and return typed Stake data directly via simulation.
   */
  async fetchStake(stakeId: bigint | number): Promise<Stake> {
    const caller = this.defaultCaller || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const tx = await this.getStake(stakeId, caller);
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
      const native = scValToNative(sim.result.retval) as Record<string, unknown>;
      const hashRaw = native['msg_hash'];
      const hashHex =
        Buffer.isBuffer(hashRaw) || hashRaw instanceof Uint8Array
          ? Buffer.from(hashRaw).toString('hex')
          : String(hashRaw);
      return {
        id: BigInt(native['id'] as string | number | bigint),
        sender: String(native['sender']),
        recipient: String(native['recipient']),
        token: String(native['token']),
        amount: BigInt(native['amount'] as string | number | bigint),
        msg_hash: hashHex,
        created_at: BigInt(native['created_at'] as string | number | bigint),
        deadline: BigInt(native['deadline'] as string | number | bigint),
        status: native['status'] as Stake['status'],
      };
    }
    const err = parseContractError(sim);
    if (err) throw err;
    throw new Error('Failed to fetch stake');
  }

  /**
   * Query and return typed PriceConfig data directly via simulation.
   */
  async fetchPrice(recipient: string): Promise<PriceConfig> {
    const caller = this.defaultCaller || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const tx = await this.getPrice(recipient, caller);
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
      const native = scValToNative(sim.result.retval) as Record<string, unknown>;
      return {
        min_amount: BigInt(native['min_amount'] as string | number | bigint),
        min_window_secs: BigInt(native['min_window_secs'] as string | number | bigint),
        max_window_secs: BigInt(native['max_window_secs'] as string | number | bigint),
      };
    }
    const err = parseContractError(sim);
    if (err) throw err;
    throw new Error('Failed to fetch price config');
  }

  // ---------------------------------------------------------------------------
  // Submit and wait with polling & error mapping
  // ---------------------------------------------------------------------------

  /**
   * Submit a signed transaction, poll until confirmed, and map any contract error.
   */
  async submitAndWait(
    tx: Transaction | string,
    options?: SubmitOptions
  ): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
    const timeoutSecs = options?.timeoutSecs ?? 60;
    const pollIntervalMs = options?.pollIntervalMs ?? 1000;

    const txObj =
      typeof tx === 'string'
        ? (TransactionBuilder.fromXDR(tx, this.networkPassphrase) as Transaction)
        : tx;

    const sendResponse = await this.server.sendTransaction(txObj);

    if ((sendResponse.status as string) === 'ERROR') {
      const parsed = parseContractError(sendResponse);
      if (parsed) {
        throw parsed;
      }
      throw new Error(`sendTransaction failed: ${JSON.stringify(sendResponse)}`);
    }

    const hash = sendResponse.hash;
    const deadline = Date.now() + timeoutSecs * 1000;

    while (Date.now() < deadline) {
      const txResponse = await this.server.getTransaction(hash);

      if ((txResponse.status as string) === 'SUCCESS') {
        return txResponse as rpc.Api.GetSuccessfulTransactionResponse;
      }

      if ((txResponse.status as string) === 'FAILED') {
        const parsed = parseContractError(txResponse);
        if (parsed) {
          throw parsed;
        }
        throw new Error(`Transaction execution failed: ${hash}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Transaction submission timed out after ${timeoutSecs}s for hash: ${hash}`);
  }
}
