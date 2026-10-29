/**
 * services/sweeper/src/types.ts
 * Types for the Stellar Postage Sweeper (Keeper) service.
 */

export interface PendingStakeRecord {
  id: string; // message id
  stake_id: bigint | number | string;
  status: string;
  ttl_expiry?: number | bigint | undefined;
  deadline?: number | bigint | undefined;
}

export interface SweeperDataAccess {
  findPendingStakeMessages(): Promise<PendingStakeRecord[]>;
  updateMessageStatus(id: string, status: string): Promise<unknown>;
}

export interface SweeperConfig {
  graceSecs?: number | undefined; // default: 3600 (1 hour)
  ttlThresholdSecs?: number | undefined; // default: 86400 (1 day)
  maxRetries?: number | undefined;
  initialBackoffMs?: number | undefined;
  backoffFactor?: number | undefined;
  pollIntervalMs?: number | undefined;
}

export interface ClaimResultItem {
  messageId: string;
  stakeId: bigint;
  txHash: string;
}

export interface TtlExtendResultItem {
  messageId: string;
  stakeId: bigint;
  txHash: string;
}

export interface SkippedItem {
  messageId: string;
  stakeId: bigint;
  reason: string;
}

export interface ErrorItem {
  messageId: string;
  stakeId: bigint;
  error: string;
}

export interface SweepResult {
  executed: boolean;
  claimed: ClaimResultItem[];
  ttlExtended: TtlExtendResultItem[];
  skipped: SkippedItem[];
  errors: ErrorItem[];
}
