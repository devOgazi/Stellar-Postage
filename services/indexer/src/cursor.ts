import type { Pool, PoolClient } from 'pg';

export interface CursorStore {
  getCursor(): Promise<number | null>;
  setCursor(ledger: number): Promise<void>;
}

export class DurableCursor implements CursorStore {
  private inMemoryLedger: number | null = null;
  private readonly db?: Pool | PoolClient | undefined;
  private readonly cursorKey: string;

  constructor(db?: Pool | PoolClient | undefined, cursorKey: string = 'soroban_escrow_events') {
    this.db = db;
    this.cursorKey = cursorKey;
  }

  async initTable(): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS chain_cursors (
          id TEXT PRIMARY KEY,
          last_ledger BIGINT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);
    } catch {
      // In-memory or restricted DB fallback
    }
  }

  async getCursor(): Promise<number | null> {
    if (this.db) {
      try {
        const res = await this.db.query(
          'SELECT last_ledger FROM chain_cursors WHERE id = $1',
          [this.cursorKey]
        );
        if (res.rows.length > 0 && res.rows[0]?.last_ledger !== undefined) {
          return parseInt(res.rows[0].last_ledger, 10);
        }
      } catch {
        // Fallback to in-memory
      }
    }
    return this.inMemoryLedger;
  }

  async setCursor(ledger: number): Promise<void> {
    this.inMemoryLedger = ledger;
    if (this.db) {
      try {
        await this.db.query(
          `INSERT INTO chain_cursors (id, last_ledger, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (id) DO UPDATE
           SET last_ledger = EXCLUDED.last_ledger,
               updated_at = now()`,
          [this.cursorKey, ledger.toString()]
        );
      } catch {
        // In-memory preserved
      }
    }
  }
}
