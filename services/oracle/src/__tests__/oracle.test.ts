import crypto from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { LocalSigner, KmsSignerStub } from '../signer.js';
import { ChannelAccountPool } from '../channelPool.js';
import { OracleService, type ReplyEvidenceInput } from '../oracle.js';
import { TransactionSubmitter } from '../submitter.js';
import { mockFn } from './mock.js';

describe('Oracle Service v1', () => {
  const oracleKeypair = Keypair.random();
  const channelKeypair1 = Keypair.random();
  const channelKeypair2 = Keypair.random();

  let localSigner: LocalSigner;
  let channelPool: ChannelAccountPool;
  let mockEscrowClient: any;
  let mockDal: any;

  beforeEach(() => {
    localSigner = new LocalSigner(oracleKeypair.secret());
    channelPool = new ChannelAccountPool([
      channelKeypair1.publicKey(),
      channelKeypair2.publicKey(),
    ]);

    mockEscrowClient = {
      fetchStake: mockFn(() => ({
        id: 100n,
        sender: 'GBOB_SENDER',
        recipient: 'GALICE_RECIPIENT',
        token: 'CUSDC_SAC',
        amount: 50_000_000n,
        msg_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        created_at: 1000n,
        deadline: 2000n,
        status: 'Pending',
      })),
      confirmReply: mockFn((_stakeId: any, _caller: any) => {
        return {
          hash: () => Buffer.from('mock-tx-hash-bytes-32-chars-long'),
          sign: mockFn(),
          toXDR: () => 'mock-xdr',
        };
      }),
      submitAndWait: mockFn(() => ({
        hash: 'tx_confirmed_hash_123456',
        latestLedger: 54321,
      })),
    };

    mockDal = {
      findReplyEvidenceById: mockFn(() => null),
      updateReplyEvidenceOracleTx: mockFn(() => ({})),
      findMessageById: mockFn(() => ({ id: 'msg-1', stake_id: '100' })),
    };
  });

  const createValidEvidence = (overrides?: Partial<ReplyEvidenceInput>): ReplyEvidenceInput => {
    const payload = {
      reply_message_id: 1234,
      reply_to_message_id: 5678,
      text: 'Thanks Alice, received!',
    };
    const canonicalJson = JSON.stringify(payload, Object.keys(payload).sort());
    const hash = crypto.createHash('sha256').update(canonicalJson).digest();

    return {
      id: 'evidence-uuid-1',
      message_id: 'msg-1',
      kind: 'telegram',
      payload,
      hash,
      stake_id: 100n,
      ...overrides,
    };
  };

  it('exposes NO capability other than confirmReply', () => {
    const oracle = new OracleService(mockEscrowClient, localSigner, channelPool, mockDal);
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(oracle)).filter(
      (m) => m !== 'constructor' && !m.startsWith('_')
    );
    expect(methods).toEqual(['confirmReply']);
  });

  it('success: re-verifies evidence, signs, submits confirm_reply, and logs attestation', async () => {
    const oracle = new OracleService(mockEscrowClient, localSigner, channelPool, mockDal);
    const evidence = createValidEvidence();

    const now = 1500 * 1000; // 1500s is before deadline (2000s) + grace (3600s)
    const result = await oracle.confirmReply(evidence, { now });

    expect(result.success).toBe(true);
    expect(result.stakeId).toBe(100n);
    expect(result.txHash).toBe('tx_confirmed_hash_123456');

    // On-chain verification performed
    expect(mockEscrowClient.fetchStake.calls).toHaveLength(1);
    expect(mockEscrowClient.fetchStake.calls[0]).toEqual([100n]);
    expect(mockEscrowClient.confirmReply.calls).toHaveLength(1);

    // Attestation logged with evidence hash and tx hash into reply_evidence.oracle_tx
    expect(mockDal.updateReplyEvidenceOracleTx.calls).toHaveLength(1);
    expect(mockDal.updateReplyEvidenceOracleTx.calls[0]).toEqual([
      'evidence-uuid-1',
      'tx_confirmed_hash_123456',
    ]);
  });

  it('duplicate evidence: rejects if oracle_tx already set', async () => {
    const oracle = new OracleService(mockEscrowClient, localSigner, channelPool, mockDal);

    // 1. In input object
    const evidenceAlreadySubmitted = createValidEvidence({
      oracle_tx: 'already_submitted_tx_hash',
    });
    await expect(oracle.confirmReply(evidenceAlreadySubmitted)).rejects.toThrow(
      /DUPLICATE_EVIDENCE/
    );

    // 2. In database
    mockDal.findReplyEvidenceById.mockResolvedValueOnce({
      id: 'evidence-uuid-1',
      oracle_tx: 'existing_db_tx_hash',
    });
    const freshEvidence = createValidEvidence();
    await expect(oracle.confirmReply(freshEvidence)).rejects.toThrow(
      /DUPLICATE_EVIDENCE/
    );

    // No tx was submitted
    expect(mockEscrowClient.confirmReply.calls).toHaveLength(0);
  });

  it('tampered evidence: rejects if payload does not match hash', async () => {
    const oracle = new OracleService(mockEscrowClient, localSigner, channelPool, mockDal);

    const tamperedEvidence = createValidEvidence({
      payload: { text: 'Tampered text that changes hash' },
    });

    await expect(oracle.confirmReply(tamperedEvidence)).rejects.toThrow(
      /TAMPERED_EVIDENCE/
    );

    // No on-chain call or submission
    expect(mockEscrowClient.fetchStake.calls).toHaveLength(0);
    expect(mockEscrowClient.confirmReply.calls).toHaveLength(0);
  });

  it('expired stake: rejects if current time exceeds deadline + grace', async () => {
    const oracle = new OracleService(mockEscrowClient, localSigner, channelPool, mockDal, {
      graceSecs: 3600,
    });
    const evidence = createValidEvidence();

    // deadline = 2000s, grace = 3600s, expiry = 5600s. Now = 5601s
    const lateTimeMs = 5601 * 1000;
    await expect(
      oracle.confirmReply(evidence, { now: lateTimeMs })
    ).rejects.toThrow(/EXPIRED_STAKE/);

    expect(mockEscrowClient.confirmReply.calls).toHaveLength(0);
  });

  it('not pending: rejects if on-chain stake is already Refunded or Claimed', async () => {
    mockEscrowClient.fetchStake.mockResolvedValueOnce({
      id: 100n,
      status: 'Refunded',
      deadline: 2000n,
    });

    const oracle = new OracleService(mockEscrowClient, localSigner, channelPool, mockDal);
    const evidence = createValidEvidence();

    await expect(oracle.confirmReply(evidence)).rejects.toThrow(/NOT_PENDING/);
    expect(mockEscrowClient.confirmReply.calls).toHaveLength(0);
  });

  it('retry behavior: handles txBAD_SEQ and resource limits with bounded retries and backoff', async () => {
    let attempts = 0;
    const delays: number[] = [];

    // Fails on attempt 0 with txBAD_SEQ, attempt 1 with resource limit, succeeds on attempt 2
    mockEscrowClient.submitAndWait.mockImplementation(() => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Transaction submission failed: txBAD_SEQ');
      }
      if (attempts === 2) {
        throw new Error('Simulation failed: resource limit exceeded');
      }
      return Promise.resolve({ hash: 'tx_eventual_success_hash' });
    });

    const submitter = new TransactionSubmitter(mockEscrowClient, localSigner, channelPool, {
      maxRetries: 3,
      initialBackoffMs: 100,
      backoffFactor: 2,
    });

    const customSleep = (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    };

    const res = await submitter.submitConfirmReply(100n, customSleep);
    expect(res.txHash).toBe('tx_eventual_success_hash');
    expect(attempts).toBe(3);
    // Backoff delays recorded: 100ms, then 200ms
    expect(delays).toEqual([100, 200]);
  });

  it('retry behavior: throws after max retries exceeded', async () => {
    mockEscrowClient.submitAndWait.mockImplementation(() => {
      throw new Error('txBAD_SEQ sequence error');
    });

    const submitter = new TransactionSubmitter(mockEscrowClient, localSigner, channelPool, {
      maxRetries: 2,
      initialBackoffMs: 50,
      backoffFactor: 2,
    });

    await expect(submitter.submitConfirmReply(100n, () => Promise.resolve())).rejects.toThrow(
      /txBAD_SEQ/
    );
  });

  it('channel account pool: manages parallel checkout and release', async () => {
    expect(channelPool.totalCount).toBe(2);
    expect(channelPool.availableCount).toBe(2);

    const c1 = await channelPool.acquire();
    expect(channelPool.availableCount).toBe(1);

    const c2 = await channelPool.acquire();
    expect(channelPool.availableCount).toBe(0);

    channelPool.release(c1);
    expect(channelPool.availableCount).toBe(1);

    channelPool.release(c2);
    expect(channelPool.availableCount).toBe(2);
  });

  it('Signer: KmsSignerStub signs transaction', async () => {
    const kms = new KmsSignerStub({ keyId: 'arn:aws:kms:us-east-1:123456789:key/dummy' });
    const mockTx = {
      hash: () => Buffer.from('mock-hash-bytes-32-chars-long!!'),
      signatures: [] as any[],
    } as any;

    const signed = await kms.signTransaction(mockTx);
    expect(signed.signatures).toHaveLength(1);
    expect(await kms.getPublicKey()).toBeDefined();
  });
});
