/**
 * apps/api/src/db/migrate.ts
 * Migration runner script for Stellar Postage.
 * Executed via: pnpm db:migrate
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getPool } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(
  clientOrPool?: pg.Pool | pg.PoolClient | pg.Client
): Promise<string[]> {
  const pool = clientOrPool ?? getPool();
  const applied: string[] = [];

  // Locate db/migrations folder relative to repo root
  const migrationsDir = path.resolve(__dirname, '../../../../db/migrations');

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  // Ensure migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const existing = await pool.query(
      'SELECT name FROM _migrations WHERE name = $1',
      [file]
    );

    if (existing.rows.length > 0) {
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`==> Applying migration: ${file}`);
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      applied.push(file);
      console.log(`    Successfully applied ${file}`);
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error(`    Failed to apply ${file}:`, err);
      throw err;
    }
  }

  return applied;
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = getPool();
  runMigrations(pool)
    .then((applied) => {
      console.log(`Migration finished. Applied ${applied.length} new migration(s).`);
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
