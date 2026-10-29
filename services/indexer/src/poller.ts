import { rpc } from '@stellar/stellar-sdk';
import { decodeEvent, type DecodedEvent } from '@stellar-postage/sdk';
import type { IndexerConfig, IndexerDataAccess, IndexerHealth } from './types.js';
import type { CursorStore } from './cursor.js';

export interface SorobanEventRaw {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string[];
  value: {
    xdr: string;
  } | string;
  txHash: string;
  inSuccessfulContractCall?: boolean;
}

export class SorobanEventPoller {
  private readonly server: rpc.Server;
  private readonly dal: IndexerDataAccess;
  private readonly cursorStore: CursorStore;
  private readonly contractId: string;
  private readonly retentionWindow: number;

  private currentLedger: number = 0;
  private latestLedger: number = 0;
  private isPolling: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    config: IndexerConfig,
    dal: IndexerDataAccess,
    cursorStore: CursorStore,
    server?: rpc.Server
  ) {
    this.contractId = config.contractId;
    this.dal = dal;
    this.cursorStore = cursorStore;
    this.retentionWindow = config.retentionWindowLedgers ?? 17_280; // ~24h at 5s/ledger

    const rpcUrl = config.rpcUrl || 'https://soroban-testnet.stellar.org';
    this.server = server || new rpc.Server(rpcUrl);
    if (config.startLedger) {
      this.currentLedger = config.startLedger;
    }
  }

  getCurrentLedger(): number {
    return this.currentLedger;
  }

  getLatestLedger(): number {
    return this.latestLedger;
  }

  getHealth(): IndexerHealth {
    const lag = Math.max(0, this.latestLedger - this.currentLedger);
    return {
      status: lag <= 100 ? 'ok' : 'degraded',
      currentLedger: this.currentLedger,
      latestLedger: this.latestLedger,
      lag,
    };
  }

  /**
   * Executes a single poll cycle. Returns count of events processed.
   */
  async pollOnce(): Promise<number> {
    // 1. Determine starting cursor
    let startLedger = await this.cursorStore.getCursor();
    if (!startLedger || startLedger <= 0) {
      if (this.currentLedger > 0) {
        startLedger = this.currentLedger;
      } else {
        const latestInfo = await this.server.getLatestLedger();
        startLedger = latestInfo.sequence;
      }
    }

    this.currentLedger = startLedger;

    // 2. Fetch latest ledger to check retention gap
    let latestSequence: number;
    try {
      const latestInfo = await this.server.getLatestLedger();
      latestSequence = latestInfo.sequence;
      this.latestLedger = latestSequence;
    } catch {
      latestSequence = startLedger;
      this.latestLedger = startLedger;
    }

    // 3. Enforce RPC retention limits: Fail loudly with a clear message
    if (latestSequence - startLedger > this.retentionWindow) {
      throw new Error(
        `RPC retention limit exceeded: requested start ledger ${startLedger} is older than retention window (${this.retentionWindow} ledgers behind latest ${latestSequence}). Gaps cannot be bridged automatically; manual backfill required.`
      );
    }

    // 4. Query events via getEvents
    let eventsResponse: rpc.Api.GetEventsResponse;
    try {
      eventsResponse = await this.server.getEvents({
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [this.contractId],
          },
        ],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/retention|history|older than/i.test(msg)) {
        throw new Error(
          `RPC retention limit exceeded: requested start ledger ${startLedger} is no longer retained by the node: ${msg}. Manual backfill required.`
        );
      }
      throw err;
    }

    if (eventsResponse.latestLedger) {
      this.latestLedger = eventsResponse.latestLedger;
    }

    const events = eventsResponse.events || [];
    let processedCount = 0;
    let maxLedgerSeen = startLedger;

    // 5. Decode, upsert chain_events with (ledger, tx_hash, event_idx) primary key, and update messages
    for (let idx = 0; idx < events.length; idx++) {
      const raw = events[idx] as unknown as SorobanEventRaw;
      const ledger = raw.ledger;
      const txHash = raw.txHash || `tx_${ledger}_${idx}`;
      const eventIdx = parseInt(raw.id.split('-')[1] || idx.toString(), 10) || idx;

      if (ledger > maxLedgerSeen) {
        maxLedgerSeen = ledger;
      }

      const decoded: DecodedEvent | null = decodeEvent(raw);
      if (!decoded) continue;

      const topic = decoded.type;
      const stakeId = 'stake_id' in decoded ? decoded.stake_id : null;

      // Upsert into chain_events for idempotency
      await this.dal.insertChainEvent({
        ledger,
        tx_hash: txHash,
        event_idx: eventIdx,
        topic,
        stake_id: stakeId ? stakeId.toString() : null,
        payload: decoded,
      });

      // Update messages.status accordingly
      if (stakeId !== null && this.dal.updateMessageStatus && this.dal.findMessageByStakeId) {
        const msg = await this.dal.findMessageByStakeId(stakeId);
        if (msg) {
          switch (topic) {
            case 'sent':
              await this.dal.updateMessageStatus(msg.id, 'delivered');
              break;
            case 'replied':
              await this.dal.updateMessageStatus(msg.id, 'replied');
              break;
            case 'spam':
              await this.dal.updateMessageStatus(msg.id, 'spam');
              break;
            case 'claimed':
              // README: "claimed -> expired" (funds claimed by recipient after deadline)
              await this.dal.updateMessageStatus(msg.id, 'expired');
              break;
          }
        }
      }

      processedCount++;
    }

    // 6. Update cursor
    const nextCursor = events.length > 0 ? maxLedgerSeen + 1 : Math.max(startLedger, this.latestLedger);
    this.currentLedger = nextCursor;
    await this.cursorStore.setCursor(nextCursor);

    return processedCount;
  }

  start(intervalMs: number = 3000): void {
    if (this.isPolling) return;
    this.isPolling = true;

    const run = async () => {
      if (!this.isPolling) return;
      try {
        await this.pollOnce();
      } catch (err: unknown) {
        console.error('Indexer poll error:', err);
      } finally {
        if (this.isPolling) {
          this.pollTimer = setTimeout(run, intervalMs);
          if (typeof this.pollTimer.unref === 'function') {
            this.pollTimer.unref();
          }
        }
      }
    };

    void run();
  }

  stop(): void {
    this.isPolling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
