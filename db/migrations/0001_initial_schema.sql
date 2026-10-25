-- 0001_initial_schema.sql
-- Initial schema for Stellar Postage (matches README "Database Schema" section verbatim)

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stellar_address TEXT UNIQUE NOT NULL,
  handle          TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  kind        TEXT CHECK (kind IN ('telegram', 'email')),
  external_id TEXT NOT NULL,           -- telegram chat id or email address
  verified_at TIMESTAMPTZ,
  UNIQUE (kind, external_id)
);

CREATE TABLE pricing (
  user_id         UUID PRIMARY KEY REFERENCES users(id),
  min_amount      NUMERIC(20,7) NOT NULL,
  min_window_secs INT NOT NULL,
  max_window_secs INT NOT NULL,
  allowlist       JSONB DEFAULT '[]'
);

CREATE TABLE messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stake_id     BIGINT UNIQUE,          -- on-chain id
  sender_addr  TEXT NOT NULL,
  recipient_id UUID REFERENCES users(id),
  channel_id   UUID REFERENCES channels(id),
  body_enc     BYTEA NOT NULL,         -- encrypted at rest
  msg_hash     BYTEA NOT NULL,         -- matches on-chain msg_hash
  external_ref TEXT,                   -- telegram message_id or email Message-ID
  proxy_addr   TEXT UNIQUE,            -- email reply proxy
  status       TEXT NOT NULL,          -- pending | delivered | replied | spam | expired
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE reply_evidence (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID REFERENCES messages(id),
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  hash        BYTEA NOT NULL,
  oracle_tx   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chain_events (
  ledger     BIGINT NOT NULL,
  tx_hash    TEXT NOT NULL,
  event_idx  INT NOT NULL,
  topic      TEXT NOT NULL,
  stake_id   BIGINT,
  payload    JSONB,
  PRIMARY KEY (ledger, tx_hash, event_idx)
);
