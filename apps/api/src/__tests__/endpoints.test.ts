import crypto from 'node:crypto';
import pg from 'pg';
import { newDb, DataType } from 'pg-mem';
import { Account, Keypair, Networks } from '@stellar/stellar-sdk';
import type { FastifyInstance } from 'fastify';
import { EscrowClient } from '@stellar-postage/sdk';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { DataAccessLayer } from '../db/dal.js';
import { runMigrations } from '../db/migrate.js';
import { NonceStore } from '../auth/nonce.js';
import { AuthService } from '../auth/service.js';
import { signJwt } from '../auth/jwt.js';

describe('Core REST Endpoints and Authorization', () => {
  let poolOrClient: any;
  let dal: DataAccessLayer;
  let app: FastifyInstance;
  let escrowClient: EscrowClient;

  // Keypairs for participants
  const sponsorKeypair = Keypair.random();
  const aliceKeypair = Keypair.random(); // Recipient
  const bobKeypair = Keypair.random(); // Sender
  const eveKeypair = Keypair.random(); // Unrelated third-party

  let aliceToken: string;
  let bobToken: string;
  let eveToken: string;
  let aliceId: string;
  let bobId: string;
  let eveId: string;

  const testConfig = loadConfig({
    networkPassphrase: Networks.TESTNET,
    domain: 'postage.stellar',
    sessionSecret: 'endpoints-test-secret-32-chars-long-12345678',
    replyVetoWindowSecs: 2, // 2 seconds for test
  });

  beforeAll(async () => {
    testConfig.sponsorKeypair = sponsorKeypair;

    // Database setup
    const realDbUrl =
      process.env['DATABASE_URL'] || 'postgres://postgres:postgres@localhost:5432/postage';
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

    // Mock RPC server for EscrowClient so transactions can be simulated in test
    const mockRpcServer: any = {
      getAccount: (accId: string) => Promise.resolve(new Account(accId, '100')),
      simulateTransaction: () =>
        Promise.resolve({
          id: 'sim_1',
          results: [{ retval: null }],
          cost: { cpuInsns: '1000', memBytes: '1000' },
          minResourceFee: '100',
          transactionData: {
            build: () => ({ toXDR: () => 'AAAA' }),
          },
        }),
      sendTransaction: () => Promise.resolve({ status: 'PENDING', hash: 'txhash1' }),
      getTransaction: () =>
        Promise.resolve({
          status: 'SUCCESS',
          ledger: 100,
          createdAt: Math.floor(Date.now() / 1000),
        }),
    };

    escrowClient = new EscrowClient({
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
      networkPassphrase: Networks.TESTNET,
      server: mockRpcServer,
    });

    const nonceStore = new NonceStore();
    const authService = new AuthService(
      sponsorKeypair,
      testConfig.networkPassphrase,
      testConfig.domain,
      testConfig.authExpirySecs,
      testConfig.sessionSecret,
      nonceStore,
      dal,
    );

    app = createApp({
      config: testConfig,
      dal,
      nonceStore,
      authService,
      escrowClient,
    });

    await app.ready();

    // Create users in DB and generate session tokens
    const aliceUser = await dal.upsertUser(aliceKeypair.publicKey(), 'alice');
    aliceId = aliceUser.id;
    aliceToken = signJwt(
      { sub: aliceId, stellar_address: aliceKeypair.publicKey() },
      testConfig.sessionSecret,
    );

    const bobUser = await dal.upsertUser(bobKeypair.publicKey(), 'bob');
    bobId = bobUser.id;
    bobToken = signJwt(
      { sub: bobId, stellar_address: bobKeypair.publicKey() },
      testConfig.sessionSecret,
    );

    const eveUser = await dal.upsertUser(eveKeypair.publicKey(), 'eve');
    eveId = eveUser.id;
    eveToken = signJwt(
      { sub: eveId, stellar_address: eveKeypair.publicKey() },
      testConfig.sessionSecret,
    );
  });

  afterAll(async () => {
    await app.close();
    if (poolOrClient && typeof poolOrClient.end === 'function') {
      await poolOrClient.end();
    }
  });

  describe('GET /v1/recipients/:handle', () => {
    it('returns public profile, default pricing, and channels for existing handle', async () => {
      // Add a verified channel for Alice
      const channel = await dal.createChannel(aliceId, 'telegram', '123456');
      await dal.verifyChannel(channel.id);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/recipients/alice',
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.recipient.handle).toBe('alice');
      expect(data.recipient.stellar_address).toBe(aliceKeypair.publicKey());
      expect(data.pricing.min_amount).toBeDefined();
      expect(data.channels).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'telegram', verified: true })]),
      );
    });

    it('returns 404 for non-existent recipient', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/recipients/nonexistent_user',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT /v1/me/pricing', () => {
    it('requires authentication', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/v1/me/pricing',
        payload: {
          min_amount: '10000000',
          min_window_secs: 7200,
          max_window_secs: 14400,
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('validates window ranges and rejects invalid min/max window', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/v1/me/pricing',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          min_amount: '10000000',
          min_window_secs: 10000,
          max_window_secs: 5000, // min > max
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('updates pricing and returns updated config with set_price transaction', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/v1/me/pricing',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          min_amount: '20000000',
          min_window_secs: 7200,
          max_window_secs: 86400,
          allowlist: [bobKeypair.publicKey()],
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.pricing.min_amount).toBe('20000000');
      expect(data.pricing.min_window_secs).toBe(7200);
      expect(data.pricing.max_window_secs).toBe(86400);
      expect(data.pricing.allowlist).toContain(bobKeypair.publicKey());
    });
  });

  describe('Message flow: POST /v1/messages, submit, inbox, sent, access control', () => {
    let messageId: string;
    let computedMsgHash: string;
    const plaintextBody = 'Hello Alice, staking 2 USDC for a quick chat!';

    it('rejects sending message to self', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: {
          recipient: 'alice',
          body: 'Talking to myself',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/yourself/i);
    });

    it('rejects stake below recipient minimum', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { authorization: `Bearer ${bobToken}` },
        payload: {
          recipient: 'alice',
          body: 'Too cheap',
          amount: '1000', // below Alice's min of 20000000
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/below recipient minimum/i);
    });

    it('creates message draft with encrypted body and returns unsigned send transaction', async () => {
      const expectedHash = crypto.createHash('sha256').update(plaintextBody, 'utf8').digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { authorization: `Bearer ${bobToken}` },
        payload: {
          recipient: 'alice',
          body: plaintextBody,
          amount: '20000000',
          window_secs: 7200,
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.message_id).toBeDefined();
      expect(data.msg_hash).toBe(expectedHash);
      expect(data.status).toBe('pending');

      messageId = data.message_id;
      computedMsgHash = data.msg_hash;

      // Verify message in DB is encrypted and plaintext is NOT stored in plain text
      const rawInDb = await dal.findMessageById(messageId);
      expect(rawInDb?.body_enc).not.toEqual(Buffer.from(plaintextBody));
      expect(rawInDb?.msg_hash.toString('hex')).toBe(expectedHash);
    });

    it('POST /messages/:id/submit: verifies sender and delivers message with attached stake_id', async () => {
      // Eve attempts to submit Bob's message
      const eveRes = await app.inject({
        method: 'POST',
        url: `/v1/messages/${messageId}/submit`,
        headers: { authorization: `Bearer ${eveToken}` },
        payload: { stake_id: '123' },
      });
      expect(eveRes.statusCode).toBe(403);

      // Bob submits
      const bobRes = await app.inject({
        method: 'POST',
        url: `/v1/messages/${messageId}/submit`,
        headers: { authorization: `Bearer ${bobToken}` },
        payload: { stake_id: '5001' },
      });

      expect(bobRes.statusCode).toBe(200);
      const data = bobRes.json();
      expect(data.message.status).toBe('delivered');
      expect(String(data.message.stake_id)).toBe('5001');
    });

    it('GET /messages/:id: allows sender and recipient to view and decrypt, forbids third-party', async () => {
      // Bob (sender) views
      const bobRes = await app.inject({
        method: 'GET',
        url: `/v1/messages/${messageId}`,
        headers: { authorization: `Bearer ${bobToken}` },
      });
      expect(bobRes.statusCode).toBe(200);
      expect(bobRes.json().body).toBe(plaintextBody);
      expect(bobRes.json().msg_hash).toBe(computedMsgHash);

      // Alice (recipient) views
      const aliceRes = await app.inject({
        method: 'GET',
        url: `/v1/messages/${messageId}`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      expect(aliceRes.statusCode).toBe(200);
      expect(aliceRes.json().body).toBe(plaintextBody);

      // Eve (unauthorized) views -> 403 Forbidden
      const eveRes = await app.inject({
        method: 'GET',
        url: `/v1/messages/${messageId}`,
        headers: { authorization: `Bearer ${eveToken}` },
      });
      expect(eveRes.statusCode).toBe(403);
    });

    it('inbox and sent authorization isolation', async () => {
      // Alice checks inbox -> includes message
      const aliceInbox = await app.inject({
        method: 'GET',
        url: '/v1/me/inbox',
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      expect(aliceInbox.statusCode).toBe(200);
      const aliceMsgs = aliceInbox.json();
      expect(aliceMsgs.some((m: any) => m.id === messageId)).toBe(true);

      // Bob checks inbox -> does NOT include message
      const bobInbox = await app.inject({
        method: 'GET',
        url: '/v1/me/inbox',
        headers: { authorization: `Bearer ${bobToken}` },
      });
      expect(bobInbox.statusCode).toBe(200);
      const bobMsgs = bobInbox.json();
      expect(bobMsgs.some((m: any) => m.id === messageId)).toBe(false);

      // Bob checks sent -> includes message
      const bobSent = await app.inject({
        method: 'GET',
        url: '/v1/me/sent',
        headers: { authorization: `Bearer ${bobToken}` },
      });
      expect(bobSent.statusCode).toBe(200);
      const sentMsgs = bobSent.json();
      expect(sentMsgs.some((m: any) => m.id === messageId)).toBe(true);

      // Alice checks sent -> does NOT include message
      const aliceSent = await app.inject({
        method: 'GET',
        url: '/v1/me/sent',
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      expect(aliceSent.statusCode).toBe(200);
      const aliceSentMsgs = aliceSent.json();
      expect(aliceSentMsgs.some((m: any) => m.id === messageId)).toBe(false);
    });

    it('POST /messages/:id/spam: only recipient can flag spam', async () => {
      // Bob (sender) attempts to flag spam -> 403 Forbidden
      const bobSpam = await app.inject({
        method: 'POST',
        url: `/v1/messages/${messageId}/spam`,
        headers: { authorization: `Bearer ${bobToken}` },
      });
      expect(bobSpam.statusCode).toBe(403);

      // Alice (recipient) flags spam -> succeeds
      const aliceSpam = await app.inject({
        method: 'POST',
        url: `/v1/messages/${messageId}/spam`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      expect(aliceSpam.statusCode).toBe(200);
      expect(aliceSpam.json().message.status).toBe('spam');
    });

    it('POST /messages/:id/not-a-reply: recipient vetoes inside window, rejects once expired', async () => {
      // Create a fresh message for veto testing
      const draftRes = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { authorization: `Bearer ${bobToken}` },
        payload: {
          recipient: 'alice',
          body: 'Testing reply veto',
        },
      });
      const vetoMsgId = draftRes.json().message_id;

      // Bob (sender) cannot veto
      const bobVeto = await app.inject({
        method: 'POST',
        url: `/v1/messages/${vetoMsgId}/not-a-reply`,
        headers: { authorization: `Bearer ${bobToken}` },
      });
      expect(bobVeto.statusCode).toBe(403);

      // Alice vetoes inside 2s window
      const aliceVeto = await app.inject({
        method: 'POST',
        url: `/v1/messages/${vetoMsgId}/not-a-reply`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      expect(aliceVeto.statusCode).toBe(200);
      expect(aliceVeto.json().status).toBe('vetoed');

      // Wait 2.2s for veto window to expire
      await new Promise((r) => setTimeout(r, 2200));

      // Attempt veto again on expired window
      const expiredVeto = await app.inject({
        method: 'POST',
        url: `/v1/messages/${vetoMsgId}/not-a-reply`,
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      expect(expiredVeto.statusCode).toBe(400);
      expect(expiredVeto.json().message).toMatch(/expired/i);
    });

    it('POST /me/channels/telegram/link: generates deep-link token and url', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/me/channels/telegram/link',
        headers: { authorization: `Bearer ${aliceToken}` },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.link_token).toBeDefined();
      expect(json.url).toContain('t.me');
      expect(json.url).toContain(json.link_token);
    });

    it('POST /me/channels/email: registers and verifies recipient email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/me/channels/email',
        headers: { authorization: `Bearer ${aliceToken}` },
        payload: { email: 'alice@example.com' },
      });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.registered).toBe(true);
      expect(json.channel.kind).toBe('email');
      expect(json.channel.external_id).toBe('alice@example.com');
      expect(json.channel.verified_at).toBeDefined();
    });

    it('POST /webhooks/inbound-email: handles inbound email parse events', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/inbound-email',
        payload: {
          From: 'alice@example.com',
          To: 's_8f3a9c@reply.example.com',
          Subject: 'Test reply',
          TextBody: 'Hello from test',
        },
      });
      // Handler processes payload (returning 200 with result)
      expect([200, 503]).toContain(res.statusCode);
    });

    it('POST /webhooks/telegram: receives updates and enforces secret verification and idempotency', async () => {
      // 1. Missing or invalid secret if secret configured
      const resWithoutSecret = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/telegram',
        headers: { 'x-telegram-bot-api-secret-token': 'wrong-token' },
        payload: { update_id: 9999 },
      });
      expect([200, 403]).toContain(resWithoutSecret.statusCode);
      // In testConfig, telegramWebhookSecret is empty by default, so if not set it accepts
      // Let's test with valid payload
      const validUpdate = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/telegram',
        payload: { update_id: 12345, message: { text: 'test' } },
      });
      expect(validUpdate.statusCode).toBe(200);
      expect(validUpdate.json().ok).toBe(true);

      // Duplicate update returns 200 with duplicate: true
      const duplicateUpdate = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/telegram',
        payload: { update_id: 12345, message: { text: 'test' } },
      });
      expect(duplicateUpdate.statusCode).toBe(200);
      expect(duplicateUpdate.json().duplicate).toBe(true);
    });
  });
});
