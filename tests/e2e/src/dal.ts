/**
 * tests/e2e/src/dal.ts
 * Typed data-access layer for the E2E integration test suite.
 */

import type { Pool, PoolClient } from 'pg';

export interface UserRow {
  id: string;
  stellar_address: string;
  handle: string | null;
  created_at: Date;
}

export interface ChannelRow {
  id: string;
  user_id: string | null;
  kind: 'telegram' | 'email';
  external_id: string;
  verified_at: Date | null;
}

export interface PricingRow {
  user_id: string;
  min_amount: string;
  min_window_secs: number;
  max_window_secs: number;
  allowlist: unknown[];
}

export type MessageStatus = 'pending' | 'delivered' | 'replied' | 'spam' | 'expired';

export interface MessageRow {
  id: string;
  stake_id: string | null;
  sender_addr: string;
  recipient_id: string | null;
  channel_id: string | null;
  body_enc: Buffer;
  msg_hash: Buffer;
  external_ref: string | null;
  proxy_addr: string | null;
  status: MessageStatus;
  created_at: Date;
}

export interface ReplyEvidenceRow {
  id: string;
  message_id: string | null;
  kind: string;
  payload: unknown;
  hash: Buffer;
  oracle_tx: string | null;
  created_at: Date;
}

export interface ChainEventRow {
  ledger: string;
  tx_hash: string;
  event_idx: number;
  topic: string;
  stake_id: string | null;
  payload: unknown;
}

export type Queryable = Pool | PoolClient;

export class DataAccessLayer {
  constructor(private readonly db: Queryable) {}

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

  async findPendingStakeMessages(): Promise<
    Array<{
      id: string;
      stake_id: string;
      status: string;
      ttl_expiry?: number | bigint;
      deadline?: number | bigint;
    }>
  > {
    const res = await this.db.query<MessageRow>(
      "SELECT id, stake_id, sender_addr, recipient_id, channel_id, body_enc, msg_hash, external_ref, proxy_addr, status, created_at FROM messages WHERE status IN ('pending', 'delivered') AND stake_id IS NOT NULL",
    );
    return res.rows.map((r) => ({
      ...r,
      stake_id: r.stake_id!,
    }));
  }

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
        JSON.stringify(params.payload ?? null, (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
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
