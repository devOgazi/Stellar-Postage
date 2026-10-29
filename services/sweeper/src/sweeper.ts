/**
 * services/sweeper/src/sweeper.ts
 * Main Sweeper (Keeper) service.
 * Finds expired stakes and submits claim(stake_id); bumps TTLs for active stakes nearing expiry.
 */

import type { EscrowClient, Stake } from '@stellar-postage/sdk';
import type { SweeperSubmitter } from './submitter.js';
import type { LockProvider } from './lock.js';
import type {
  SweeperDataAccess,
  SweeperConfig,
  SweepResult,
  ClaimResultItem,
  TtlExtendResultItem,
  SkippedItem,
  ErrorItem,
} from './types.js';

export class SweeperService {
  private readonly escrowClient: EscrowClient;
  private readonly submitter: SweeperSubmitter;
  private readonly lock: LockProvider;
  private readonly dal: SweeperDataAccess;
  private readonly graceSecs: number;
  private readonly ttlThresholdSecs: number;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;

  constructor(
    escrowClient: EscrowClient,
    submitter: SweeperSubmitter,
    lock: LockProvider,
    dal: SweeperDataAccess,
    config?: SweeperConfig | undefined
  ) {
    this.escrowClient = escrowClient;
    this.submitter = submitter;
    this.lock = lock;
    this.dal = dal;
    this.graceSecs = config?.graceSecs ?? 3600;
    this.ttlThresholdSecs = config?.ttlThresholdSecs ?? 86400; // 1 day
    this.pollIntervalMs = config?.pollIntervalMs ?? 60000;
  }

  /**
   * Run a single sweep pass.
   * Concurrency-safe: wraps execution inside advisory lock.
   * If another runner holds the lock, this run is skipped cleanly.
   */
  async sweep(options?: {
    now?: number | undefined;
    retryDelayFn?: ((ms: number) => Promise<void>) | undefined;
    shouldExtendTtl?: ((stake: Stake, nowSecs: number) => boolean) | undefined;
  }): Promise<SweepResult> {
    const lockOutcome = await this.lock.withLock(async () => {
      const nowSecs =
        options?.now !== undefined
          ? Math.floor(options.now / 1000)
          : Math.floor(Date.now() / 1000);

      const claimed: ClaimResultItem[] = [];
      const ttlExtended: TtlExtendResultItem[] = [];
      const skipped: SkippedItem[] = [];
      const errors: ErrorItem[] = [];

      const pendingMessages = await this.dal.findPendingStakeMessages();

      for (const msg of pendingMessages) {
        if (msg.stake_id === null || msg.stake_id === undefined) {
          continue;
        }

        const stakeId = BigInt(msg.stake_id);

        try {
          // Re-verify on-chain state via fetchStake / get_stake
          const onChainStake = await this.escrowClient.fetchStake(stakeId);

          if (onChainStake.status !== 'Pending') {
            // Already settled (Claimed or Refunded)
            skipped.push({
              messageId: msg.id,
              stakeId,
              reason: `On-chain status is ${onChainStake.status}, not Pending`,
            });
            continue;
          }

          // Exact contract condition: current time must pass deadline + grace
          const deadlineWithGrace = Number(onChainStake.deadline) + this.graceSecs;

          if (nowSecs > deadlineWithGrace) {
            // Expired: anyone can claim
            const res = await this.submitter.submitClaim(stakeId, options?.retryDelayFn);
            await this.dal.updateMessageStatus(msg.id, 'expired');
            claimed.push({
              messageId: msg.id,
              stakeId,
              txHash: res.txHash,
            });
          } else {
            // NOT yet past deadline + grace: MUST NEVER call claim
            let extend = false;

            if (options?.shouldExtendTtl) {
              extend = options.shouldExtendTtl(onChainStake, nowSecs);
            } else if (msg.ttl_expiry !== undefined) {
              const ttlSecs = Number(msg.ttl_expiry);
              if (nowSecs + this.ttlThresholdSecs >= ttlSecs) {
                extend = true;
              }
            }

            if (extend) {
              const res = await this.submitter.submitExtendTtl(stakeId, options?.retryDelayFn);
              ttlExtended.push({
                messageId: msg.id,
                stakeId,
                txHash: res.txHash,
              });
            } else {
              skipped.push({
                messageId: msg.id,
                stakeId,
                reason: `Stake within deadline + grace (${deadlineWithGrace - nowSecs}s remaining)`,
              });
            }
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({
            messageId: msg.id,
            stakeId,
            error: message,
          });
        }
      }

      return {
        claimed,
        ttlExtended,
        skipped,
        errors,
      };
    });

    if (!lockOutcome.executed || !lockOutcome.result) {
      return {
        executed: false,
        claimed: [],
        ttlExtended: [],
        skipped: [
          {
            messageId: '',
            stakeId: 0n,
            reason: 'Lock already held by another sweeper instance',
          },
        ],
        errors: [],
      };
    }

    return {
      executed: true,
      ...lockOutcome.result,
    };
  }

  /**
   * Start recurring cron sweeps.
   */
  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.sweep().catch((err) => {
        // Log background sweep errors
        console.error('Sweeper background run error:', err);
      });
    }, this.pollIntervalMs);
  }

  /**
   * Stop recurring cron sweeps.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }
}
