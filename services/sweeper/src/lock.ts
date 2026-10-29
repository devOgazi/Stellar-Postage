import type { Pool, PoolClient } from 'pg';

export const DEFAULT_SWEEPER_LOCK_ID = 8847291; // 64-bit integer advisory lock key

export interface LockProvider {
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
  withLock<T>(operation: () => Promise<T>): Promise<{ executed: boolean; result?: T }>;
}

export class PostgresAdvisoryLock implements LockProvider {
  private readonly db?: Pool | PoolClient | undefined;
  private readonly lockId: number;
  private isLocallyLocked: boolean = false;

  constructor(db?: Pool | PoolClient | undefined, lockId: number = DEFAULT_SWEEPER_LOCK_ID) {
    this.db = db;
    this.lockId = lockId;
  }

  async tryAcquire(): Promise<boolean> {
    if (this.isLocallyLocked) {
      return false;
    }

    if (this.db) {
      try {
        const res = await this.db.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1) as locked',
          [this.lockId]
        );
        const locked = res.rows[0]?.locked ?? false;
        if (locked) {
          this.isLocallyLocked = true;
          return true;
        }
        return false;
      } catch {
        // Fallback to local memory lock
      }
    }

    this.isLocallyLocked = true;
    return true;
  }

  async release(): Promise<void> {
    if (!this.isLocallyLocked) {
      return;
    }

    if (this.db) {
      try {
        await this.db.query('SELECT pg_advisory_unlock($1)', [this.lockId]);
      } catch {
        // Fallback
      }
    }

    this.isLocallyLocked = false;
  }

  async withLock<T>(operation: () => Promise<T>): Promise<{ executed: boolean; result?: T }> {
    const acquired = await this.tryAcquire();
    if (!acquired) {
      return { executed: false };
    }

    try {
      const result = await operation();
      return { executed: true, result };
    } finally {
      await this.release();
    }
  }
}
