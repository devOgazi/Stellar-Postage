/**
 * packages/sdk/src/__tests__/integration.test.ts
 * Opt-in testnet integration test.
 * Set RUN_INTEGRATION_TESTS=true or TESTNET=true to run against live Stellar testnet.
 */

import { EscrowClient } from '../client.js';

const shouldRun =
  process.env['RUN_INTEGRATION_TESTS'] === 'true' ||
  process.env['TESTNET'] === 'true';

const conditionalDescribe = shouldRun ? describe : describe.skip;

conditionalDescribe('Testnet Integration Tests (opt-in)', () => {
  const contractId =
    process.env['ESCROW_CONTRACT_ID'] ||
    process.env['CONTRACT_ID'] ||
    'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const rpcUrl =
    process.env['SOROBAN_RPC_URL'] || 'https://soroban-testnet.stellar.org';

  let client: EscrowClient;

  beforeAll(() => {
    client = new EscrowClient({
      contractId,
      rpcUrl,
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('can connect to testnet Soroban RPC server', async () => {
    const health = await client.server.getHealth();
    expect(health.status).toBe('healthy');
  });

  it('queries contract getPrice without errors', async () => {
    const testRecipient =
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    const priceTx = await client.getPrice(testRecipient, testRecipient);
    expect(priceTx).toBeDefined();
  });
});
