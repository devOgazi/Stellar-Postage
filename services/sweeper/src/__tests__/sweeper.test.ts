/// <reference path="../../../../node_modules/.pnpm/@types+jest@29.5.12/node_modules/@types/jest/index.d.ts" />
import { Keypair } from '@stellar/stellar-sdk';
import { SweeperService } from '../sweeper.js';
import { SweeperSubmitter } from '../submitter.js';
import { ChannelAccountPool } from '../channelPool.js';
import { PostgresAdvisoryLock, type LockProvider } from '../lock.js';
import type { SweeperDataAccess, PendingStakeRecord } from '../types.js';
import type { EscrowClient, Stake } from '@stellar-postage/sdk';
import { mockFn } from './mock.js';

describe('SweeperService', () => {
  let mockEscrowClient: any;
  let mockDal: any;
  let channelPool: ChannelAccountPool;
  let submitter: SweeperSubmitter;
  let lock: LockProvider;
  let keypair: Keypair;

  const mockChannelKeypair = Keypair.random();
  const mockChannels = [mockChannelKeypair.publicKey()];

  beforeEach(() => {
    keypair = Keypair.random();
    channelPool = new ChannelAccountPool(mockChannels);

    mockEscrowClient = {
      fetchStake: mockFn(),
      claim: mockFn().mockResolvedValue({
        sign: mockFn(),
        hash: () => Buffer.from('mock_claim_hash', 'utf-8'),
      }),
      extendTtl: mockFn().mockResolvedValue({
        sign: mockFn(),
        hash: () => Buffer.from('mock_ttl_hash', 'utf-8'),
      }),
      submitAndWait: mockFn().mockResolvedValue({
        status: 'SUCCESS',
        hash: 'tx_claim_123',
        ledger: 100,
      }),
    };

    mockDal = {
      findPendingStakeMessages: mockFn().mockResolvedValue([]),
      updateMessageStatus: mockFn().mockResolvedValue({}),
    };

    lock = new PostgresAdvisoryLock(); // local in-memory lock
    submitter = new SweeperSubmitter(mockEscrowClient as any, channelPool, keypair, {
      maxRetries: 3,
      initialBackoffMs: 10,
    });
  });

  it('should claim expired stake when deadline + grace has passed', async () => {
    const deadline = 1000n;
    const graceSecs = 3600;
    // deadline + grace = 4600. Current time = 4601 (strictly passed)
    const nowMs = 4601 * 1000;

    const pendingMsg: PendingStakeRecord = {
      id: 'msg-1',
      stake_id: '42',
      status: 'pending',
    };

    mockDal.findPendingStakeMessages.mockResolvedValue([pendingMsg]);
    mockEscrowClient.fetchStake.mockResolvedValue({
      id: 42n,
      sender: 'GB...',
      recipient: 'GC...',
      token: 'CA...',
      amount: 10000000n,
      msg_hash: 'abc',
      created_at: 500n,
      deadline,
      status: 'Pending',
    } as Stake);

    const sweeper = new SweeperService(
      mockEscrowClient as any,
      submitter,
      lock,
      mockDal as SweeperDataAccess,
      { graceSecs }
    );

    const result = await sweeper.sweep({ now: nowMs });

    expect(result.executed).toBe(true);
    expect(result.claimed).toHaveLength(1);
    expect(result.claimed[0]?.stakeId).toBe(42n);
    expect(mockEscrowClient.claim.calls).toHaveLength(1);
    expect(mockEscrowClient.claim.calls[0]?.[0]).toBe(42n);
    expect(mockDal.updateMessageStatus.calls).toHaveLength(1);
    expect(mockDal.updateMessageStatus.calls[0]).toEqual(['msg-1', 'expired']);
  });

  describe('Invariant: MUST NEVER call claim before deadline + grace', () => {
    it('never calls claim when current time is strictly before deadline', async () => {
      const deadline = 5000n;
      const graceSecs = 3600;
      // Before deadline: now = 4000
      const nowMs = 4000 * 1000;

      const pendingMsg: PendingStakeRecord = {
        id: 'msg-2',
        stake_id: 101,
        status: 'pending',
      };

      mockDal.findPendingStakeMessages.mockResolvedValue([pendingMsg]);
      mockEscrowClient.fetchStake.mockResolvedValue({
        id: 101n,
        sender: 'GB...',
        recipient: 'GC...',
        token: 'CA...',
        amount: 5000000n,
        msg_hash: 'def',
        created_at: 1000n,
        deadline,
        status: 'Pending',
      } as Stake);

      const sweeper = new SweeperService(
        mockEscrowClient as any,
        submitter,
        lock,
        mockDal as SweeperDataAccess,
        { graceSecs }
      );

      const result = await sweeper.sweep({ now: nowMs });

      expect(result.executed).toBe(true);
      expect(result.claimed).toHaveLength(0);
      expect(mockEscrowClient.claim.calls).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.reason).toContain('deadline + grace');
    });

    it('never calls claim when current time is within grace window', async () => {
      const deadline = 5000n;
      const graceSecs = 3600;
      // Inside grace: deadline (5000) <= now (6000) < deadline + grace (8600)
      const nowMs = 6000 * 1000;

      const pendingMsg: PendingStakeRecord = {
        id: 'msg-3',
        stake_id: 102,
        status: 'pending',
      };

      mockDal.findPendingStakeMessages.mockResolvedValue([pendingMsg]);
      mockEscrowClient.fetchStake.mockResolvedValue({
        id: 102n,
        sender: 'GB...',
        recipient: 'GC...',
        token: 'CA...',
        amount: 5000000n,
        msg_hash: 'def',
        created_at: 1000n,
        deadline,
        status: 'Pending',
      } as Stake);

      const sweeper = new SweeperService(
        mockEscrowClient as any,
        submitter,
        lock,
        mockDal as SweeperDataAccess,
        { graceSecs }
      );

      const result = await sweeper.sweep({ now: nowMs });

      expect(result.executed).toBe(true);
      expect(result.claimed).toHaveLength(0);
      expect(mockEscrowClient.claim.calls).toHaveLength(0);
    });

    it('never calls claim at exact deadline + grace boundary', async () => {
      const deadline = 5000n;
      const graceSecs = 3600;
      // Exact boundary: 5000 + 3600 = 8600.
      const nowMs = 8600 * 1000;

      const pendingMsg: PendingStakeRecord = {
        id: 'msg-4',
        stake_id: 103,
        status: 'pending',
      };

      mockDal.findPendingStakeMessages.mockResolvedValue([pendingMsg]);
      mockEscrowClient.fetchStake.mockResolvedValue({
        id: 103n,
        sender: 'GB...',
        recipient: 'GC...',
        token: 'CA...',
        amount: 5000000n,
        msg_hash: 'def',
        created_at: 1000n,
        deadline,
        status: 'Pending',
      } as Stake);

      const sweeper = new SweeperService(
        mockEscrowClient as any,
        submitter,
        lock,
        mockDal as SweeperDataAccess,
        { graceSecs }
      );

      const result = await sweeper.sweep({ now: nowMs });

      expect(result.executed).toBe(true);
      expect(result.claimed).toHaveLength(0);
      expect(mockEscrowClient.claim.calls).toHaveLength(0);
    });
  });

  it('should call extend_ttl for Pending stakes nearing TTL expiry', async () => {
    const deadline = 10000n;
    const graceSecs = 3600;
    const nowMs = 5000 * 1000; // well before deadline

    const pendingMsg: PendingStakeRecord = {
      id: 'msg-ttl',
      stake_id: 201,
      status: 'pending',
      ttl_expiry: 5000 + 3600, // expires in 1 hour
    };

    mockDal.findPendingStakeMessages.mockResolvedValue([pendingMsg]);
    mockEscrowClient.fetchStake.mockResolvedValue({
      id: 201n,
      sender: 'GB...',
      recipient: 'GC...',
      token: 'CA...',
      amount: 5000000n,
      msg_hash: 'ghi',
      created_at: 1000n,
      deadline,
      status: 'Pending',
    } as Stake);

    const sweeper = new SweeperService(
      mockEscrowClient as any,
      submitter,
      lock,
      mockDal as SweeperDataAccess,
      { graceSecs, ttlThresholdSecs: 86400 } // threshold 1 day > 1 hour remaining
    );

    const result = await sweeper.sweep({ now: nowMs });

    expect(result.executed).toBe(true);
    expect(result.ttlExtended).toHaveLength(1);
    expect(result.ttlExtended[0]?.stakeId).toBe(201n);
    expect(mockEscrowClient.extendTtl.calls).toHaveLength(1);
    expect(mockEscrowClient.extendTtl.calls[0]?.[0]).toBe(201n);
    expect(mockEscrowClient.claim.calls).toHaveLength(0);
  });

  it('should skip non-pending stakes without calling claim', async () => {
    const nowMs = 10000 * 1000;

    const pendingMsg: PendingStakeRecord = {
      id: 'msg-settled',
      stake_id: 301,
      status: 'pending',
    };

    mockDal.findPendingStakeMessages.mockResolvedValue([pendingMsg]);
    mockEscrowClient.fetchStake.mockResolvedValue({
      id: 301n,
      sender: 'GB...',
      recipient: 'GC...',
      token: 'CA...',
      amount: 5000000n,
      msg_hash: 'jkl',
      created_at: 1000n,
      deadline: 2000n,
      status: 'Refunded',
    } as Stake);

    const sweeper = new SweeperService(
      mockEscrowClient as any,
      submitter,
      lock,
      mockDal as SweeperDataAccess
    );

    const result = await sweeper.sweep({ now: nowMs });

    expect(result.executed).toBe(true);
    expect(result.claimed).toHaveLength(0);
    expect(mockEscrowClient.claim.calls).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('Refunded');
  });

  it('should skip run when advisory lock is held concurrently', async () => {
    const sweeper = new SweeperService(
      mockEscrowClient as any,
      submitter,
      lock,
      mockDal as SweeperDataAccess
    );

    // Hold lock manually
    await lock.tryAcquire();

    const result = await sweeper.sweep();

    expect(result.executed).toBe(false);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('Lock already held');
    expect(mockDal.findPendingStakeMessages.calls).toHaveLength(0);

    // Release lock
    await lock.release();
  });

  it('should retry transaction on txBAD_SEQ and resource limits', async () => {
    let callCount = 0;
    mockEscrowClient.submitAndWait.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('txBAD_SEQ: bad sequence number');
      }
      return {
        status: 'SUCCESS',
        hash: 'tx_claim_retried',
        ledger: 101,
      };
    });

    const pendingMsg: PendingStakeRecord = {
      id: 'msg-retry',
      stake_id: 401,
      status: 'pending',
    };

    mockDal.findPendingStakeMessages.mockResolvedValue([pendingMsg]);
    mockEscrowClient.fetchStake.mockResolvedValue({
      id: 401n,
      sender: 'GB...',
      recipient: 'GC...',
      token: 'CA...',
      amount: 5000000n,
      msg_hash: 'mno',
      created_at: 1000n,
      deadline: 2000n,
      status: 'Pending',
    } as Stake);

    const sweeper = new SweeperService(
      mockEscrowClient as any,
      submitter,
      lock,
      mockDal as SweeperDataAccess,
      { graceSecs: 100 }
    );

    const result = await sweeper.sweep({
      now: 5000 * 1000,
      retryDelayFn: async () => {},
    });

    expect(result.executed).toBe(true);
    expect(result.claimed).toHaveLength(1);
    expect(result.claimed[0]?.txHash).toBe('tx_claim_retried');
    expect(callCount).toBe(2);
  });
});
