import crypto from 'node:crypto';
import pg from 'pg';
import { newDb, DataType } from 'pg-mem';
import { Keypair, Networks, Transaction } from '@stellar/stellar-sdk';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { DataAccessLayer } from '../db/dal.js';
import { runMigrations } from '../db/migrate.js';
import { NonceStore } from '../auth/nonce.js';
import { AuthService } from '../auth/service.js';

describe('Sign-In With Stellar Authentication', () => {
  let poolOrClient: any;
  let dal: DataAccessLayer;
  let app: FastifyInstance;
  let sponsorKeypair: Keypair;
  let nonceStore: NonceStore;
  let authService: AuthService;

  const testConfig = loadConfig({
    networkPassphrase: Networks.TESTNET,
    domain: 'postage.stellar',
    authExpirySecs: 300,
    sessionSecret: 'super-secret-jwt-key-for-auth-tests-12345',
  });

  beforeAll(async () => {
    sponsorKeypair = Keypair.random();
    testConfig.sponsorKeypair = sponsorKeypair;

    const realDbUrl = process.env['DATABASE_URL'] || 'postgres://postgres:postgres@localhost:5432/postage';
    const testPool = new pg.Pool({
      connectionString: realDbUrl,
      connectionTimeoutMillis: 1000,
    });

    try {
      await testPool.query('SELECT 1');
      poolOrClient = testPool;
    } catch {
      await testPool.end().catch(() => {});
      const memDb = newDb();
      memDb.public.registerFunction({
        name: 'gen_random_uuid',
        returns: DataType.uuid,
        impure: true,
        implementation: () => crypto.randomUUID(),
      });
      const pgMock = memDb.adapters.createPg();
      poolOrClient = new pgMock.Pool();
    }

    dal = new DataAccessLayer(poolOrClient);
    await runMigrations(poolOrClient);

    nonceStore = new NonceStore();
    authService = new AuthService(
      sponsorKeypair,
      testConfig.networkPassphrase,
      testConfig.domain,
      testConfig.authExpirySecs,
      testConfig.sessionSecret,
      nonceStore,
      dal
    );

    app = createApp({
      config: testConfig,
      dal,
      nonceStore,
      authService,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (poolOrClient && typeof poolOrClient.end === 'function') {
      await poolOrClient.end();
    }
  });

  it('valid challenge: client requests, signs, verifies, and gets session JWT', async () => {
    const client = Keypair.random();

    // 1. Request challenge
    const challengeRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/challenge',
      payload: { address: client.publicKey() },
    });

    expect(challengeRes.statusCode).toBe(200);
    const challengeData = challengeRes.json();
    expect(challengeData.transaction).toBeDefined();
    expect(challengeData.network_passphrase).toBe(Networks.TESTNET);

    // 2. Client signs challenge
    const clientTx = new Transaction(challengeData.transaction, Networks.TESTNET);
    clientTx.sign(client);
    const signedXdr = clientTx.toXDR();

    // 3. Verify signed challenge
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { challenge: signedXdr },
    });

    expect(verifyRes.statusCode).toBe(200);
    const verifyData = verifyRes.json();
    expect(verifyData.token).toBeDefined();
    expect(verifyData.user).toBeDefined();
    expect(verifyData.user.stellar_address).toBe(client.publicKey());
    expect(verifyData.user.id).toBeDefined();

    // 4. Verify user exists in DB
    const dbUser = await dal.findUserByAddress(client.publicKey());
    expect(dbUser).not.toBeNull();
    expect(dbUser?.id).toBe(verifyData.user.id);
  });

  it('expired challenge: rejects challenge after expiration window', async () => {
    const client = Keypair.random();

    // Generate a challenge with 1 second expiry
    const shortExpiryService = new AuthService(
      sponsorKeypair,
      testConfig.networkPassphrase,
      testConfig.domain,
      1, // 1 second expiry
      testConfig.sessionSecret,
      nonceStore,
      dal
    );

    const challenge = shortExpiryService.generateChallenge(client.publicKey());
    const clientTx = new Transaction(challenge.transaction, Networks.TESTNET);
    clientTx.sign(client);

    // Wait 1.5 seconds for it to expire
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { challenge: clientTx.toXDR() },
    });

    expect(verifyRes.statusCode).toBe(401);
    const errData = verifyRes.json();
    expect(errData.message).toMatch(/expired/i);
  });

  it('replayed challenge: rejects submitting the same signed challenge twice', async () => {
    const client = Keypair.random();

    const challengeRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/challenge',
      payload: { address: client.publicKey() },
    });
    expect(challengeRes.statusCode).toBe(200);
    const { transaction } = challengeRes.json();

    const clientTx = new Transaction(transaction, Networks.TESTNET);
    clientTx.sign(client);
    const signedXdr = clientTx.toXDR();

    // First submission: succeeds
    const firstRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { challenge: signedXdr },
    });
    expect(firstRes.statusCode).toBe(200);

    // Second submission: must fail due to replay protection (nonce consumed)
    const secondRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { challenge: signedXdr },
    });
    expect(secondRes.statusCode).toBe(401);
    const errData = secondRes.json();
    expect(errData.message).toMatch(/nonce|replayed|invalid/i);
  });

  it('tampered challenge: rejects challenge signed by unauthorized attacker key', async () => {
    const client = Keypair.random();
    const attacker = Keypair.random();

    const challengeRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/challenge',
      payload: { address: client.publicKey() },
    });
    expect(challengeRes.statusCode).toBe(200);
    const { transaction } = challengeRes.json();

    // Attacker signs client's challenge
    const attackerTx = new Transaction(transaction, Networks.TESTNET);
    attackerTx.sign(attacker);
    const attackerSignedXdr = attackerTx.toXDR();

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { challenge: attackerSignedXdr },
    });

    expect(verifyRes.statusCode).toBe(401);
    const errData = verifyRes.json();
    expect(errData.message).toMatch(/signature|signers/i);
  });

  it('malformed challenge: rejects invalid base64 or garbage data', async () => {
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { challenge: 'not-valid-stellar-xdr' },
    });

    expect(verifyRes.statusCode).toBe(401);
    const errData = verifyRes.json();
    expect(errData.message).toMatch(/invalid/i);
  });

  it('rejects challenge request with invalid stellar public key', async () => {
    const challengeRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/challenge',
      payload: { address: 'INVALID_STELLAR_ADDRESS' },
    });

    expect(challengeRes.statusCode).toBe(400);
  });
});
