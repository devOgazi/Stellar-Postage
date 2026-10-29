/**
 * services/indexer/src/index.ts
 */

export * from './types.js';
export * from './cursor.js';
export * from './poller.js';
export * from './server.js';

import pg from 'pg';
import { DurableCursor } from './cursor.js';
import { SorobanEventPoller } from './poller.js';
import { createHealthServer } from './server.js';

// CLI entrypoint if executed directly
if (process.argv[1]?.endsWith('services/indexer/src/index.ts')) {
  console.log('Starting Soroban Event Indexer...');
  const dbUrl = process.env['DATABASE_URL'] || 'postgres://postgres:postgres@localhost:5432/postage';
  const pool = new pg.Pool({ connectionString: dbUrl });

  const cursorStore = new DurableCursor(pool);
  cursorStore.initTable().then(() => {
    const dal = {
      async insertChainEvent(params: any) {
        await pool.query(
          `INSERT INTO chain_events (ledger, tx_hash, event_idx, topic, stake_id, payload)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (ledger, tx_hash, event_idx) DO NOTHING`,
          [
            params.ledger.toString(),
            params.tx_hash,
            params.event_idx,
            params.topic,
            params.stake_id ? params.stake_id.toString() : null,
            JSON.stringify(params.payload ?? null),
          ]
        );
      },
      async updateMessageStatus(id: string, status: string) {
        await pool.query('UPDATE messages SET status = $1 WHERE id = $2', [status, id]);
      },
      async findMessageByStakeId(stakeId: any) {
        const res = await pool.query('SELECT id, status FROM messages WHERE stake_id = $1', [stakeId.toString()]);
        return res.rows[0] ?? null;
      },
    };

    const poller = new SorobanEventPoller(
      {
        contractId: process.env['ESCROW_CONTRACT_ID'] || 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        rpcUrl: process.env['SOROBAN_RPC_URL'] || 'https://soroban-testnet.stellar.org',
      },
      dal,
      cursorStore
    );

    const port = parseInt(process.env['INDEXER_PORT'] || '4001', 10);
    const healthServer = createHealthServer(poller, port);
    healthServer.listen(port, () => {
      console.log(`Indexer healthz listening on port ${port}`);
      poller.start(parseInt(process.env['INDEXER_POLL_INTERVAL_MS'] || '3000', 10));
    });
  });
}
