import crypto from 'node:crypto';
import pg from 'pg';
import { newDb, DataType } from 'pg-mem';
import { DataAccessLayer } from '../dal.js';
import { runMigrations } from '../migrate.js';

describe('Database Migrations and Typed Data-Access Layer', () => {
  let poolOrClient: any;
  let dal: DataAccessLayer;

  beforeAll(async () => {
    // Attempt connecting to real Postgres from docker-compose if running
    const realDbUrl = process.env['DATABASE_URL'] || 'postgres://postgres:postgres@localhost:5432/postage';
    const testPool = new pg.Pool({
      connectionString: realDbUrl,
      connectionTimeoutMillis: 1000,
    });

    try {
      await testPool.query('SELECT 1');
      poolOrClient = testPool;
      console.log('Testing against real Postgres from docker-compose at:', realDbUrl);
    } catch {
      await testPool.end().catch(() => {});
      console.log('Real Postgres not reachable, falling back to pg-mem Postgres emulator');
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
  });

  afterAll(async () => {
    if (poolOrClient && typeof poolOrClient.end === 'function') {
      await poolOrClient.end();
    }
  });

  it('runs migrations and creates all schema tables and indexes', async () => {
    // Check tables exist
    const tablesRes = await poolOrClient.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tableNames = tablesRes.rows.map((r: { table_name: string }) => r.table_name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('channels');
    expect(tableNames).toContain('pricing');
    expect(tableNames).toContain('messages');
    expect(tableNames).toContain('reply_evidence');
    expect(tableNames).toContain('chain_events');
  });

  it('Users DAL: creates, finds, and updates users', async () => {
    const address = 'G' + crypto.randomBytes(16).toString('hex').toUpperCase();
    const handle = 'alice_' + crypto.randomBytes(4).toString('hex');

    const created = await dal.upsertUser(address, handle);
    expect(created.id).toBeDefined();
    expect(created.stellar_address).toBe(address);
    expect(created.handle).toBe(handle);

    const foundById = await dal.findUserById(created.id);
    expect(foundById?.stellar_address).toBe(address);

    const foundByAddr = await dal.findUserByAddress(address);
    expect(foundByAddr?.id).toBe(created.id);

    const foundByHandle = await dal.findUserByHandle(handle);
    expect(foundByHandle?.id).toBe(created.id);

    const updated = await dal.updateUserHandle(created.id, handle + '_updated');
    expect(updated.handle).toBe(handle + '_updated');
  });

  it('Channels DAL: creates, queries, and verifies channels', async () => {
    const address = 'G' + crypto.randomBytes(16).toString('hex').toUpperCase();
    const user = await dal.upsertUser(address);

    const extId = '12345678_' + crypto.randomBytes(4).toString('hex');
    const channel = await dal.createChannel(user.id, 'telegram', extId);
    expect(channel.kind).toBe('telegram');
    expect(channel.external_id).toBe(extId);
    expect(channel.verified_at).toBeNull();

    const verified = await dal.verifyChannel(channel.id);
    expect(verified.verified_at).not.toBeNull();

    const byKind = await dal.findChannelByKindAndExternalId('telegram', extId);
    expect(byKind?.id).toBe(channel.id);

    const userChannels = await dal.findChannelsByUserId(user.id);
    expect(userChannels.length).toBeGreaterThan(0);
  });

  it('Pricing DAL: creates and queries pricing configs', async () => {
    const address = 'G' + crypto.randomBytes(16).toString('hex').toUpperCase();
    const user = await dal.upsertUser(address);

    const pricing = await dal.upsertPricing(
      user.id,
      50_000_000n, // 5 USDC
      3600,
      604800,
      ['GKNOWN1', 'GKNOWN2']
    );

    expect(pricing.user_id).toBe(user.id);
    expect(pricing.min_window_secs).toBe(3600);
    expect(pricing.max_window_secs).toBe(604800);

    const loaded = await dal.findPricingByUserId(user.id);
    expect(loaded?.min_window_secs).toBe(3600);
  });

  it('Messages DAL: creates message drafts, attaches stakes, and lists inbox/sent', async () => {
    const sender = 'GBOB_' + crypto.randomBytes(12).toString('hex').toUpperCase();
    const recipientAddr = 'GALICE_' + crypto.randomBytes(12).toString('hex').toUpperCase();
    const recipient = await dal.upsertUser(recipientAddr);

    const bodyEnc = Buffer.from('encrypted_payload_bytes');
    const msgHash = crypto.createHash('sha256').update('test_payload').digest();

    const message = await dal.createMessage({
      sender_addr: sender,
      recipient_id: recipient.id,
      body_enc: bodyEnc,
      msg_hash: msgHash,
      status: 'pending',
    });

    expect(message.id).toBeDefined();
    expect(message.status).toBe('pending');
    expect(message.stake_id).toBeNull();

    const stakeId = 12345n;
    const withStake = await dal.attachStakeId(message.id, stakeId);
    expect(String(withStake.stake_id)).toBe('12345');

    const byStake = await dal.findMessageByStakeId(stakeId);
    expect(byStake?.id).toBe(message.id);

    const delivered = await dal.updateMessageStatus(message.id, 'delivered');
    expect(delivered.status).toBe('delivered');

    const inbox = await dal.findInbox(recipient.id);
    expect(inbox.some((m) => m.id === message.id)).toBe(true);

    const sent = await dal.findSent(sender);
    expect(sent.some((m) => m.id === message.id)).toBe(true);
  });

  it('Reply Evidence DAL: creates and queries evidence records', async () => {
    const sender = 'GSENDER_' + crypto.randomBytes(12).toString('hex').toUpperCase();
    const message = await dal.createMessage({
      sender_addr: sender,
      body_enc: Buffer.from('test_body'),
      msg_hash: crypto.createHash('sha256').update('hash').digest(),
      status: 'delivered',
    });

    const evidence = await dal.createReplyEvidence({
      message_id: message.id,
      kind: 'telegram',
      payload: { telegram_update_id: 12345, reply_to_message_id: 6789 },
      hash: crypto.createHash('sha256').update('evidence').digest(),
      oracle_tx: 'tx_hash_123',
    });

    expect(evidence.id).toBeDefined();
    expect(evidence.oracle_tx).toBe('tx_hash_123');

    const list = await dal.findReplyEvidenceByMessageId(message.id);
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(evidence.id);
  });

  it('Chain Events DAL: records on-chain events and queries by stake_id', async () => {
    const stakeId = 9999n;
    await dal.insertChainEvent({
      ledger: 1000n,
      tx_hash: '0xabc123',
      event_idx: 0,
      topic: 'sent',
      stake_id: stakeId,
      payload: { amount: '50000000' },
    });

    const events = await dal.findChainEventsByStakeId(stakeId);
    expect(events.length).toBe(1);
    expect(events[0]?.topic).toBe('sent');
    expect(String(events[0]?.stake_id)).toBe('9999');
  });
});
