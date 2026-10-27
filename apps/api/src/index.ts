import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { getPool } from './db/pool.js';
import { DataAccessLayer } from './db/dal.js';

export * from './app.js';
export * from './config.js';
export * from './auth/index.js';
export * from './db/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const dal = new DataAccessLayer(getPool());
  const app = createApp({ config, dal });

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`Stellar Postage API listening on port ${config.port}`);
  } catch (err) {
    console.error('Error starting API server:', err);
    process.exit(1);
  }
}

// Start if executed directly
if (process.argv[1] && (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js'))) {
  void main();
}
