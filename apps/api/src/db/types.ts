/**
 * apps/api/src/db/types.ts
 * Database schema models matching README "Database Schema" section verbatim.
 */

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
  min_amount: string; // numeric(20,7)
  min_window_secs: number;
  max_window_secs: number;
  allowlist: unknown[];
}

export type MessageStatus =
  | 'pending'
  | 'delivered'
  | 'replied'
  | 'spam'
  | 'expired';

export interface MessageRow {
  id: string;
  stake_id: string | null; // bigint in pg is returned as string
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
  ledger: string; // bigint returned as string
  tx_hash: string;
  event_idx: number;
  topic: string;
  stake_id: string | null; // bigint returned as string
  payload: unknown;
}
