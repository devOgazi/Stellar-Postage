/**
 * apps/api/src/db/dal.ts
 * Typed data-access layer for the Stellar Postage PostgreSQL database.
 */

import type { Pool, PoolClient } from 'pg';
import type {
  ChainEventRow,
  ChannelRow,
  MessageRow,
  PricingRow,
  ReplyEvidenceRow,
  UserRow,
} from './types.js';

export type Queryable = Pool | PoolClient;

export class DataAccessLayer {
  constructor(private readonly db: Queryable) {}

  // =========================================================================
  // Users Repository
  // =========================================================================

  async findUserById(id: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow>(
      'SELECT id, stellar_address, handle, created_at FROM users WHERE id = $1',
      [id],
    );
    return res.rows[0] ?? null;
  }

  async findUserByAddress(stellarAddress: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow>(
      'SELECT id, stellar_address, handle, created_at FROM users WHERE stellar_address = $1',
      [stellarAddress],
    );
    return res.rows[0] ?? null;
  }

  async findUserByHandle(handle: string): Promise<UserRow | null> {
    const res = await this.db.query<UserRow>(
      'SELECT id, stellar_address, handle, created_at FROM users WHERE handle = $1',
      [handle],
    );
    return res.rows[0] ?? null;
  }

  async upsertUser(stellarAddress: string, handle?: string | null): Promise<UserRow> {
    const res = await this.db.query<UserRow>(
      `INSERT INTO users (stellar_address, handle)
       VALUES ($1, $2)
       ON CONFLICT (stellar_address) DO UPDATE
       SET handle = COALESCE(EXCLUDED.handle, users.handle)
       RETURNING id, stellar_address, handle, created_at`,
      [stellarAddress, handle ?? null],
    );
    const user = res.rows[0];
    if (!user) throw new Error('Failed to upsert user');
    return user;
  }

  async updateUserHandle(id: string, handle: string): Promise<UserRow> {
    const res = await this.db.query<UserRow>(
      'UPDATE users SET handle = $1 WHERE id = $2 RETURNING id, stellar_address, handle, created_at',
      [handle, id],
    );
    const user = res.rows[0];
    if (!user) throw new Error(`User not found: ${id}`);
    return user;
  }

  // =========================================================================
  // Channels Repository
  // =========================================================================

  async findChannelById(id: string): Promise<ChannelRow | null> {
    const res = await this.db.query<ChannelRow>(
      'SELECT id, user_id, kind, external_id, verified_at FROM channels WHERE id = $1',
      [id],
    );
    return res.rows[0] ?? null;
  }

  async findChannelByKindAndExternalId(
    kind: 'telegram' | 'email',
    externalId: string,
  ): Promise<ChannelRow | null> {
    const res = await this.db.query<ChannelRow>(
      'SELECT id, user_id, kind, external_id, verified_at FROM channels WHERE kind = $1 AND external_id = $2',
      [kind, externalId],
    );
    return res.rows[0] ?? null;
  }

  async findChannelsByUserId(userId: string): Promise<ChannelRow[]> {
    const res = await this.db.query<ChannelRow>(
      'SELECT id, user_id, kind, external_id, verified_at FROM channels WHERE user_id = $1 ORDER BY verified_at DESC NULLS LAST',
      [userId],
    );
    return res.rows;
  }

  async createChannel(
    userId: string,
    kind: 'telegram' | 'email',
    externalId: string,
    verifiedAt?: Date | null,
  ): Promise<ChannelRow> {
    const res = await this.db.query<ChannelRow>(
      `INSERT INTO channels (user_id, kind, external_id, verified_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, kind, external_id, verified_at`,
      [userId, kind, externalId, verifiedAt ?? null],
    );
    const channel = res.rows[0];
    if (!channel) throw new Error('Failed to create channel');
    return channel;
  }

  async verifyChannel(id: string): Promise<ChannelRow> {
    const res = await this.db.query<ChannelRow>(
      'UPDATE channels SET verified_at = now() WHERE id = $1 RETURNING id, user_id, kind, external_id, verified_at',
      [id],
    );
    const channel = res.rows[0];
    if (!channel) throw new Error(`Channel not found: ${id}`);
    return channel;
  }

  async linkTelegramChannel(userId: string, externalId: string): Promise<ChannelRow> {
    const res = await this.db.query<ChannelRow>(
      `INSERT INTO channels (user_id, kind, external_id, verified_at)
       VALUES ($1, 'telegram', $2, now())
       ON CONFLICT (kind, external_id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           verified_at = now()
       RETURNING id, user_id, kind, external_id, verified_at`,
      [userId, externalId],
    );
    const channel = res.rows[0];
    if (!channel) throw new Error('Failed to link telegram channel');
    return channel;
  }

  async linkEmailChannel(userId: string, externalId: string): Promise<ChannelRow> {
    const res = await this.db.query<ChannelRow>(
      `INSERT INTO channels (user_id, kind, external_id, verified_at)
       VALUES ($1, 'email', $2, now())
       ON CONFLICT (kind, external_id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           verified_at = now()
       RETURNING id, user_id, kind, external_id, verified_at`,
      [userId, externalId.toLowerCase().trim()],
    );
    const channel = res.rows[0];
    if (!channel) throw new Error('Failed to link email channel');
    return channel;
  }

  // =========================================================================
  // Pricing Repository
  // =========================================================================

  async findPricingByUserId(userId: string): Promise<PricingRow | null> {
    const res = await this.db.query<PricingRow>(
      'SELECT user_id, min_amount, min_window_secs, max_window_secs, allowlist FROM pricing WHERE user_id = $1',
      [userId],
    );
    return res.rows[0] ?? null;
  }

  async upsertPricing(
    userId: string,
    minAmount: string | number | bigint,
    minWindowSecs: number,
    maxWindowSecs: number,
    allowlist?: unknown[],
  ): Promise<PricingRow> {
    const allowlistJson = JSON.stringify(allowlist ?? []);
    const res = await this.db.query<PricingRow>(
      `INSERT INTO pricing (user_id, min_amount, min_window_secs, max_window_secs, allowlist)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (user_id) DO UPDATE
       SET min_amount = EXCLUDED.min_amount,
           min_window_secs = EXCLUDED.min_window_secs,
           max_window_secs = EXCLUDED.max_window_secs,
           allowlist = EXCLUDED.allowlist
       RETURNING user_id, min_amount, min_window_secs, max_window_secs, allowlist`,
      [userId, minAmount.toString(), minWindowSecs, maxWindowSecs, allowlistJson],
    );
    const pricing = res.rows[0];
    if (!pricing) throw new Error('Failed to upsert pricing');
    return pricing;
  }

  // =========================================================================
  // Messages Repository
  // =========================================================================

  async createMessage(params: {
    sender_addr: string;
    recipient_id?: string | null;
    channel_id?: string | null;
    body_enc: Buffer;
    msg_hash: Buffer;
    proxy_addr?: string | null;
    status?: string;
  }): Promise<MessageRow> {
    const res = await this.db.query<MessageRow>(
      `INSERT INTO messages (sender_addr, recipient_id, channel_id, body_enc, msg_hash, proxy_addr, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at`,
      [
        params.sender_addr,
        params.recipient_id ?? null,
        params.channel_id ?? null,
        params.body_enc,
        params.msg_hash,
        params.proxy_addr ?? null,
        params.status ?? 'pending',
      ],
    );
    const msg = res.rows[0];
    if (!msg) throw new Error('Failed to create message');
    return msg;
  }

  async findMessageById(id: string): Promise<MessageRow | null> {
    const res = await this.db.query<MessageRow>(
      'SELECT id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at FROM messages WHERE id = $1',
      [id],
    );
    return res.rows[0] ?? null;
  }

  async findMessageByStakeId(stakeId: bigint | number | string): Promise<MessageRow | null> {
    const res = await this.db.query<MessageRow>(
      'SELECT id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at FROM messages WHERE stake_id = $1',
      [stakeId.toString()],
    );
    return res.rows[0] ?? null;
  }

  async updateMessageStatus(id: string, status: string): Promise<MessageRow> {
    const res = await this.db.query<MessageRow>(
      'UPDATE messages SET status = $1 WHERE id = $2 RETURNING id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at',
      [status, id],
    );
    const msg = res.rows[0];
    if (!msg) throw new Error(`Message not found: ${id}`);
    return msg;
  }

  async attachStakeId(id: string, stakeId: bigint | number | string): Promise<MessageRow> {
    const res = await this.db.query<MessageRow>(
      'UPDATE messages SET stake_id = $1 WHERE id = $2 RETURNING id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at',
      [stakeId.toString(), id],
    );
    const msg = res.rows[0];
    if (!msg) throw new Error(`Message not found: ${id}`);
    return msg;
  }

  async updateMessageExternalRef(id: string, externalRef: string): Promise<MessageRow> {
    const res = await this.db.query<MessageRow>(
      'UPDATE messages SET external_ref = $1 WHERE id = $2 RETURNING id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at',
      [externalRef, id],
    );
    const msg = res.rows[0];
    if (!msg) throw new Error(`Message not found: ${id}`);
    return msg;
  }

  async findMessageByExternalRef(externalRef: string): Promise<MessageRow | null> {
    const res = await this.db.query<MessageRow>(
      'SELECT id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at FROM messages WHERE external_ref = $1',
      [externalRef],
    );
    return res.rows[0] ?? null;
  }

  async findMessageByProxyAddr(proxyAddr: string): Promise<MessageRow | null> {
    const res = await this.db.query<MessageRow>(
      'SELECT id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at FROM messages WHERE proxy_addr = $1',
      [proxyAddr.toLowerCase().trim()],
    );
    return res.rows[0] ?? null;
  }

  async updateMessageProxyAddr(id: string, proxyAddr: string): Promise<MessageRow> {
    const res = await this.db.query<MessageRow>(
      'UPDATE messages SET proxy_addr = $1 WHERE id = $2 RETURNING id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at',
      [proxyAddr.toLowerCase().trim(), id],
    );
    const msg = res.rows[0];
    if (!msg) throw new Error(`Message not found: ${id}`);
    return msg;
  }

  async findInbox(recipientId: string): Promise<MessageRow[]> {
    const res = await this.db.query<MessageRow>(
      'SELECT id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at FROM messages WHERE recipient_id = $1 ORDER BY created_at DESC',
      [recipientId],
    );
    return res.rows;
  }

  async findSent(senderAddr: string): Promise<MessageRow[]> {
    const res = await this.db.query<MessageRow>(
      'SELECT id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at FROM messages WHERE sender_addr = $1 ORDER BY created_at DESC',
      [senderAddr],
    );
    return res.rows;
  }

  async findPendingStakeMessages(): Promise<MessageRow[]> {
    const res = await this.db.query<MessageRow>(
      "SELECT id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at FROM messages WHERE status IN ('pending', 'delivered') AND stake_id IS NOT NULL",
    );
    return res.rows;
  }

  // =========================================================================
  // Reply Evidence Repository
  // =========================================================================

  async createReplyEvidence(params: {
    message_id: string;
    kind: string;
    payload: unknown;
    hash: Buffer;
    oracle_tx?: string | null;
  }): Promise<ReplyEvidenceRow> {
    const res = await this.db.query<ReplyEvidenceRow>(
      `INSERT INTO reply_evidence (message_id, kind, payload, hash, oracle_tx)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       RETURNING id, message_id, kind, payload, hash, oracle_tx, created_at`,
      [
        params.message_id,
        params.kind,
        JSON.stringify(params.payload),
        params.hash,
        params.oracle_tx ?? null,
      ],
    );
    const evidence = res.rows[0];
    if (!evidence) throw new Error('Failed to create reply evidence');
    return evidence;
  }

  async findReplyEvidenceByMessageId(messageId: string): Promise<ReplyEvidenceRow[]> {
    const res = await this.db.query<ReplyEvidenceRow>(
      'SELECT id, message_id, kind, payload, hash, oracle_tx, created_at FROM reply_evidence WHERE message_id = $1 ORDER BY created_at ASC',
      [messageId],
    );
    return res.rows;
  }

  async findReplyEvidenceById(id: string): Promise<ReplyEvidenceRow | null> {
    const res = await this.db.query<ReplyEvidenceRow>(
      'SELECT id, message_id, kind, payload, hash, oracle_tx, created_at FROM reply_evidence WHERE id = $1',
      [id],
    );
    return res.rows[0] ?? null;
  }

  async updateReplyEvidenceOracleTx(id: string, oracleTx: string): Promise<ReplyEvidenceRow> {
    const res = await this.db.query<ReplyEvidenceRow>(
      'UPDATE reply_evidence SET oracle_tx = $1 WHERE id = $2 RETURNING id, message_id, kind, payload, hash, oracle_tx, created_at',
      [oracleTx, id],
    );
    const row = res.rows[0];
    if (!row) throw new Error(`ReplyEvidence not found: ${id}`);
    return row;
  }

  // =========================================================================
  // Chain Events Repository
  // =========================================================================

  async insertChainEvent(params: {
    ledger: bigint | number | string;
    tx_hash: string;
    event_idx: number;
    topic: string;
    stake_id?: bigint | number | string | null;
    payload?: unknown;
  }): Promise<void> {
    await this.db.query(
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
      ],
    );
  }

  async findChainEventsByStakeId(stakeId: bigint | number | string): Promise<ChainEventRow[]> {
    const res = await this.db.query<ChainEventRow>(
      'SELECT ledger, tx_hash, event_idx, topic, stake_id, payload FROM chain_events WHERE stake_id = $1 ORDER BY ledger ASC, event_idx ASC',
      [stakeId.toString()],
    );
    return res.rows;
  }
}
