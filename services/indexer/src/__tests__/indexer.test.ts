/// <reference path="../../../../node_modules/.pnpm/@types+jest@29.5.12/node_modules/@types/jest/index.d.ts" />
import http from 'node:http';
import { SorobanEventPoller } from '../poller.js';
import { DurableCursor } from '../cursor.js';
import { createHealthServer } from '../server.js';
import { RECORDED_EVENTS_FIXTURES } from './fixtures.js';
import { mockFn } from './mock.js';

describe('Soroban Event Indexer', () => {
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

  let mockDal: any;
  let insertedChainEvents: any[] = [];
  let updatedMessageStatuses: { id: string; status: string }[] = [];
  let mockServer: any;
  let cursorStore: DurableCursor;

  beforeEach(() => {
    insertedChainEvents = [];
    updatedMessageStatuses = [];

    mockDal = {
      insertChainEvent: mockFn(async (params: any) => {
        // Enforce PK uniqueness (ledger, tx_hash, event_idx)
        const exists = insertedChainEvents.some(
          (e) =>
            e.ledger === params.ledger &&
            e.tx_hash === params.tx_hash &&
            e.event_idx === params.event_idx
        );
        if (!exists) {
          insertedChainEvents.push(params);
        }
      }),
      updateMessageStatus: mockFn(async (id: string, status: string) => {
        updatedMessageStatuses.push({ id, status });
      }),
      findMessageByStakeId: mockFn(async (stakeId: any) => {
        return {
          id: `msg_for_stake_${stakeId.toString()}`,
          stake_id: stakeId.toString(),
          status: 'pending',
        };
      }),
    };

    mockServer = {
      getLatestLedger: mockFn(async () => ({ sequence: 10010 })),
      getEvents: mockFn(async () => ({
        events: RECORDED_EVENTS_FIXTURES,
        latestLedger: 10010,
      })),
    };

    cursorStore = new DurableCursor(); // In-memory store
  });

  it('decodes events and upserts into chain_events with (ledger, tx_hash, event_idx) primary key', async () => {
    const poller = new SorobanEventPoller(
      { contractId, startLedger: 10000 },
      mockDal,
      cursorStore,
      mockServer
    );

    const count = await poller.pollOnce();
    expect(count).toBe(5);

    // Verify all 5 recorded event types decoded and inserted
    expect(insertedChainEvents).toHaveLength(5);
    const topics = insertedChainEvents.map((e) => e.topic);
    expect(topics).toContain('sent');
    expect(topics).toContain('replied');
    expect(topics).toContain('spam');
    expect(topics).toContain('claimed');
    expect(topics).toContain('price');

    // Verify PK fields
    expect(insertedChainEvents[0]).toMatchObject({
      ledger: 10001,
      tx_hash: 'tx_hash_sent_100',
      event_idx: 1,
      topic: 'sent',
      stake_id: '100',
    });
  });

  it('updates messages.status accordingly (delivered, replied, spam, expired)', async () => {
    const poller = new SorobanEventPoller(
      { contractId, startLedger: 10000 },
      mockDal,
      cursorStore,
      mockServer
    );

    await poller.pollOnce();

    expect(updatedMessageStatuses).toEqual([
      { id: 'msg_for_stake_100', status: 'delivered' },
      { id: 'msg_for_stake_100', status: 'replied' },
      { id: 'msg_for_stake_101', status: 'spam' },
      { id: 'msg_for_stake_102', status: 'expired' },
    ]);
  });

  it('idempotent: duplicate event delivery does not create duplicate rows', async () => {
    const poller = new SorobanEventPoller(
      { contractId, startLedger: 10000 },
      mockDal,
      cursorStore,
      mockServer
    );

    // First run
    await poller.pollOnce();
    expect(insertedChainEvents).toHaveLength(5);

    // Replay the exact same events
    await poller.pollOnce();
    // Count remains 5 due to (ledger, tx_hash, event_idx) deduplication
    expect(insertedChainEvents).toHaveLength(5);
  });

  it('durable cursor persists and allows seamless restarts', async () => {
    const poller1 = new SorobanEventPoller(
      { contractId, startLedger: 10000 },
      mockDal,
      cursorStore,
      mockServer
    );

    await poller1.pollOnce();
    const savedCursor = await cursorStore.getCursor();
    expect(savedCursor).toBe(10006); // maxLedgerSeen (10005) + 1

    // Simulate restart with a new poller instance reading the same cursor store
    const poller2 = new SorobanEventPoller(
      { contractId },
      mockDal,
      cursorStore,
      mockServer
    );

    let startLedgerQueried = 0;
    mockServer.getEvents.mockImplementation(async (params: any) => {
      startLedgerQueried = params.startLedger;
      return {
        events: [],
        latestLedger: 10020,
      };
    });

    await poller2.pollOnce();
    // Verify it picked up exactly at the persisted cursor 10006
    expect(startLedgerQueried).toBe(10006);
  });

  it('fails loudly with a clear message when RPC retention limits are exceeded', async () => {
    // Current ledger is far behind retention window
    const poller = new SorobanEventPoller(
      {
        contractId,
        startLedger: 1000,
        retentionWindowLedgers: 5000,
      },
      mockDal,
      cursorStore,
      mockServer
    );

    mockServer.getLatestLedger.mockResolvedValueOnce({ sequence: 10000 });

    await expect(poller.pollOnce()).rejects.toThrow(
      /RPC retention limit exceeded: requested start ledger 1000 is older than retention window.*manual backfill required/i
    );
  });

  it('exposes /healthz endpoint reporting lag in ledgers', async () => {
    const poller = new SorobanEventPoller(
      { contractId, startLedger: 10000 },
      mockDal,
      cursorStore,
      mockServer
    );

    await poller.pollOnce();
    const health = poller.getHealth();
    expect(health.status).toBe('ok');
    expect(health.lag).toBeDefined();

    // Start health HTTP server
    const server = createHealthServer(poller, 0);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const response = await new Promise<{ statusCode: number; data: any }>((resolve) => {
      http.get(`http://localhost:${port}/healthz`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, data: JSON.parse(body) });
        });
      });
    });

    expect(response.statusCode).toBe(200);
    expect(response.data.status).toBe('ok');
    expect(response.data.currentLedger).toBe(poller.getCurrentLedger());
    expect(response.data.latestLedger).toBe(poller.getLatestLedger());
    expect(response.data.lag).toBe(poller.getHealth().lag);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
