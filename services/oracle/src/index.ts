/**
 * services/oracle/src/index.ts
 */

export * from './signer.js';
export * from './channelPool.js';
export * from './submitter.js';
export * from './oracle.js';

import { LocalSigner } from './signer.js';
import { ChannelAccountPool } from './channelPool.js';
import { OracleService } from './oracle.js';
import { EscrowClient } from '@stellar-postage/sdk';

// CLI entrypoint if executed directly
if (process.argv[1]?.endsWith('services/oracle/src/index.ts')) {
  const oracleSecret = process.env['ORACLE_SECRET'];
  if (!oracleSecret) {
    console.log('ORACLE_SECRET not set. Oracle service idle in dev mode.');
  } else {
    console.log('Initializing Oracle service...');
    const signer = new LocalSigner(oracleSecret);
    void signer.getPublicKey().then((pk) => {
      console.log(`Oracle active with public key: ${pk}`);
      const escrowClient = new EscrowClient({
        contractId: process.env['ESCROW_CONTRACT_ID'] || 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        rpcUrl: process.env['SOROBAN_RPC_URL'] || 'https://soroban-testnet.stellar.org',
        networkPassphrase: process.env['NETWORK_PASSPHRASE'] || 'Test SDF Network ; September 2015',
      });
      const channelPool = new ChannelAccountPool([pk]);
      // Construct the service so it is initialized and ready.
      new OracleService(escrowClient, signer, channelPool);
      console.log('Oracle service ready to verify reply evidence.');
    });
  }
}
