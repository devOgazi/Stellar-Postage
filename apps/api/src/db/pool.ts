/**
 * apps/api/src/db/pool.ts
 * PostgreSQL connection pool.
 */

import pg from 'pg';

const { Pool } = pg;

export const DEFAULT_DATABASE_URL =
  process.env['DATABASE_URL'] || 'postgres://postgres:postgres@localhost:5432/postage';

let defaultPool: pg.Pool | null = null;

export function getPool(connectionString?: string): pg.Pool {
  if (connectionString) {
    return new Pool({ connectionString });
  }
  if (!defaultPool) {
    defaultPool = new Pool({
      connectionString: DEFAULT_DATABASE_URL,
    });
  }
  return defaultPool;
}

export async function closePool(): Promise<void> {
  if (defaultPool) {
    await defaultPool.end();
    defaultPool = null;
  }
}
