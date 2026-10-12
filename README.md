# Stellar Postage

**Pay-to-reach messaging on Stellar. Stake USDC to get a busy person's attention. Get it back if they reply.**

[![Built on Stellar](https://img.shields.io/badge/built%20on-Stellar-black)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/smart%20contracts-Soroban-blueviolet)](https://soroban.stellar.org)
[![Rust](https://img.shields.io/badge/contract-Rust-orange)](https://www.rust-lang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](#license)
[![Status](https://img.shields.io/badge/status-pre--alpha-red)](#project-status)

---

## Table of Contents

1. [Overview](#overview)
2. [The Problem](#the-problem)
3. [How It Works](#how-it-works)
4. [Key Features](#key-features)
5. [Architecture](#architecture)
6. [Smart Contract Specification](#smart-contract-specification)
7. [Reply Detection (the Hard Part)](#reply-detection-the-hard-part)
8. [Backend Services](#backend-services)
9. [Database Schema](#database-schema)
10. [REST API](#rest-api)
11. [Frontend](#frontend)
12. [Wallets, Trustlines and Fee Sponsorship](#wallets-trustlines-and-fee-sponsorship)
13. [Economics and Fee Model](#economics-and-fee-model)
14. [Security and Threat Model](#security-and-threat-model)
15. [Privacy](#privacy)
16. [Repository Structure](#repository-structure)
17. [Getting Started](#getting-started)
18. [Configuration](#configuration)
19. [Testing](#testing)
20. [Deployment](#deployment)
21. [Roadmap](#roadmap)
22. [FAQ](#faq)
23. [Contributing](#contributing)
24. [License](#license)
25. [Disclaimer](#disclaimer)

---

## Overview

Stellar Postage is a spam-resistant inbox built on **Soroban**, Stellar's smart contract platform. To message a high-demand person (an investor, creator, recruiter, journalist, or founder), a sender **stakes a small amount of USDC** into an escrow contract.

- If the recipient **replies**, the stake is **returned to the sender**. Serious senders lose nothing.
- If the message is **ignored** until the deadline, or **marked as spam**, the recipient **keeps the stake**. Spammers pay.

The result is a market for attention: recipients set a price, and senders signal seriousness with real money at no net cost when the message is genuine.

## The Problem

Cold outreach is broken:

- Inboxes of well-known people are flooded with low-effort, mass-sent messages.
- Spam filters guess at intent. They miss clever spam and block legitimate messages.
- Sending a message costs nothing, so spammers can send millions.
- Recipients have no way to say "my attention costs X".

Postage fixes the incentives instead of guessing at content. If sending is free for honest senders and costly for mass senders, spam stops being profitable.

## How It Works

```
 Sender                    Soroban Escrow               Recipient
   |                             |                          |
   | 1. send(amount, msg_hash)   |                          |
   |---------------------------->| (USDC locked)            |
   |                             |                          |
   |  2. backend delivers message (Telegram / email) ------>|
   |                             |                          |
   |                             |   3a. Recipient replies  |
   |                             |<-------------------------|
   |  4a. oracle: confirm_reply  |                          |
   |<----------------------------| (stake refunded)         |
   |                             |                          |
   |            ... or ...       |                          |
   |                             |   3b. Ignored / spam     |
   |                             |   4b. claim() ---------->| (stake paid out)
```

### Lifecycle of a stake

| State | Meaning | Next states |
|---|---|---|
| `Pending` | USDC is locked, message delivered or awaiting delivery | `Refunded`, `Claimed` |
| `Refunded` | Recipient replied. Stake returned to sender (minus protocol fee, if any) | terminal |
| `Claimed` | Deadline passed or spam flagged. Recipient received the stake | terminal |

### Example

1. Alice is a venture investor. She sets her price to **5 USDC** with a 7-day reply window.
2. Bob wants to pitch her. He opens Alice's Postage link, writes his message, and stakes 5 USDC.
3. The backend delivers Bob's message to Alice on Telegram.
4. Alice replies "Interesting, send the deck". The bot detects the reply, and the oracle calls `confirm_reply`. Bob gets his 5 USDC back.
5. A spammer sends the same message to 1,000 investors, staking 5 USDC each. Most never reply, so the spammer loses most of the 5,000 USDC.

## Key Features

- **Recipient-set pricing:** each recipient sets a minimum stake, a reply window, and optional per-category prices.
- **Non-custodial escrow:** funds sit in a Soroban contract, not in the operator's wallet.
- **Oracle-attested replies:** the recipient cannot attest to their own reply, because they profit from not replying.
- **Spam flagging:** recipients can mark a message as spam for an immediate payout.
- **Permissionless sweeping:** anyone can trigger `claim` after the deadline, so recipients do not have to babysit.
- **Gasless UX:** fee-bump transactions and sponsored reserves mean users never hold XLM.
- **Off-chain messages, on-chain proof:** only a hash of the message goes on-chain.
- **Pluggable channels:** Telegram first, then email, then others (Discord, X, LinkedIn, Farcaster).
- **Allowlist and free passes:** recipients can whitelist known contacts to bypass staking.
- **Open and auditable:** every stake, refund, and claim is an on-chain event.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Frontend (Next.js)                       │
│   Recipient dashboard · Sender compose page · Wallet connection   │
└───────────────┬───────────────────────────────┬──────────────────┘
                │ REST / WebSocket              │ Stellar SDK (Soroban RPC)
                ▼                               ▼
┌───────────────────────────────┐     ┌────────────────────────────┐
│        Backend API            │     │   Soroban Escrow Contract  │
│  auth · messages · stakes     │◄───►│  stakes · prices · fees    │
└───────┬───────────────┬───────┘     └─────────────▲──────────────┘
        │               │                           │
        ▼               ▼                           │ confirm_reply()
┌──────────────┐ ┌──────────────┐          ┌─────────┴────────────┐
│  Postgres    │ │ Channel      │          │   Oracle Service     │
│  metadata    │ │ Adapters     │─ reply ─►│  verifies replies,   │
└──────────────┘ │ Telegram     │  events  │  signs & submits tx  │
                 │ Email (SMTP/ │          └──────────────────────┘
                 │ inbound hook)│
                 └──────────────┘
                        ▲
                        │
┌───────────────────────┴───────────────────┐
│ Event Indexer (Soroban RPC getEvents)      │
│ keeps DB in sync with on-chain stake state │
└───────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|---|---|
| **Escrow contract** | Holds USDC, enforces state transitions, emits events |
| **Backend API** | User accounts, message storage, stake metadata, channel linking |
| **Channel adapters** | Deliver messages and detect replies (Telegram bot, email inbound parse) |
| **Oracle service** | Holds the oracle key, validates reply evidence, calls `confirm_reply` |
| **Indexer** | Streams contract events into Postgres for fast reads |
| **Sweeper (keeper)** | Calls `claim` on expired stakes so recipients get paid automatically |
| **Frontend** | Recipient setup, sender compose and stake flow, dashboards |

## Smart Contract Specification

The contract is written in Rust with `soroban-sdk`. A single contract instance serves all users. USDC is accessed through its **Stellar Asset Contract (SAC)** via `soroban_sdk::token::Client`.

### Data types

```rust
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Pending,
    Refunded,
    Claimed,
}

#[contracttype]
#[derive(Clone)]
pub struct Stake {
    pub id: u64,
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,        // USDC SAC address
    pub amount: i128,          // in token base units (USDC on Stellar has 7 decimals)
    pub msg_hash: BytesN<32>,  // sha256 of the off-chain message payload
    pub created_at: u64,       // ledger timestamp
    pub deadline: u64,         // reply must be confirmed by this time
    pub status: Status,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Oracle,
    Treasury,
    FeeBps,            // protocol fee in basis points
    GraceSecs,         // grace period after deadline before claim is allowed
    NextId,
    Price(Address),    // recipient -> PriceConfig
    Stake(u64),        // stake id -> Stake
}

#[contracttype]
#[derive(Clone)]
pub struct PriceConfig {
    pub min_amount: i128,
    pub max_window_secs: u64,
    pub min_window_secs: u64,
}
```

### Public functions

| Function | Caller | Description |
|---|---|---|
| `initialize(admin, oracle, treasury, fee_bps, grace_secs)` | Deployer, once | Sets contract roles and parameters |
| `set_price(recipient, min_amount, min_window, max_window)` | Recipient (`require_auth`) | Sets the minimum stake and allowed reply windows |
| `send(sender, recipient, token, amount, msg_hash, window_secs) -> u64` | Sender (`require_auth`) | Validates against the recipient's price, pulls USDC into escrow, creates the stake, returns the id |
| `confirm_reply(stake_id)` | Oracle | Marks the stake `Refunded` and returns funds to the sender (minus fee) |
| `flag_spam(stake_id)` | Recipient | Marks the stake `Claimed` and pays the recipient immediately |
| `claim(stake_id)` | Anyone | After `deadline + grace`, pays the recipient if still `Pending` |
| `get_stake(stake_id) -> Stake` | Anyone | Read-only |
| `get_price(recipient) -> PriceConfig` | Anyone | Read-only |
| `set_oracle(new_oracle)` | Admin | Rotates the oracle key |
| `set_fee(fee_bps)` | Admin | Updates the protocol fee (capped at a hard maximum) |
| `pause()` / `unpause()` | Admin | Emergency stop for new `send` calls only. Existing stakes can always settle |

### Core logic sketch

```rust
pub fn send(
    env: Env,
    sender: Address,
    recipient: Address,
    token: Address,
    amount: i128,
    msg_hash: BytesN<32>,
    window_secs: u64,
) -> u64 {
    sender.require_auth();
    assert_not_paused(&env);

    let price: PriceConfig = get_price_or_default(&env, &recipient);
    assert!(amount >= price.min_amount, "stake below recipient minimum");
    assert!(
        window_secs >= price.min_window_secs && window_secs <= price.max_window_secs,
        "window out of range"
    );

    // Pull funds into escrow
    token::Client::new(&env, &token)
        .transfer(&sender, &env.current_contract_address(), &amount);

    let id = next_id(&env);
    let now = env.ledger().timestamp();
    let stake = Stake {
        id, sender, recipient, token, amount, msg_hash,
        created_at: now,
        deadline: now + window_secs,
        status: Status::Pending,
    };
    save_stake(&env, &stake); // also extends TTL
    env.events().publish((symbol_short!("sent"), id), &stake);
    id
}

pub fn confirm_reply(env: Env, stake_id: u64) {
    let oracle: Address = env.storage().instance().get(&DataKey::Oracle).unwrap();
    oracle.require_auth();

    let mut stake = load_stake(&env, stake_id);
    assert!(stake.status == Status::Pending, "not pending");
    // Replies must be confirmed before the grace period ends, so claim() cannot race it.
    assert!(env.ledger().timestamp() <= stake.deadline + grace(&env), "too late");

    let (to_sender, fee) = split_fee(&env, stake.amount);
    let tok = token::Client::new(&env, &stake.token);
    tok.transfer(&env.current_contract_address(), &stake.sender, &to_sender);
    if fee > 0 {
        tok.transfer(&env.current_contract_address(), &treasury(&env), &fee);
    }

    stake.status = Status::Refunded;
    save_stake(&env, &stake);
    env.events().publish((symbol_short!("replied"), stake_id), ());
}
```

> The sketch is illustrative. Production code should use a typed `Error` enum with `#[contracterror]` rather than `assert!`, and should add checks for `amount > 0`, self-sends, and overflow.

### Events

| Event | Topics | Data |
|---|---|---|
| `sent` | `("sent", stake_id)` | Full `Stake` |
| `replied` | `("replied", stake_id)` | none |
| `spam` | `("spam", stake_id)` | none |
| `claimed` | `("claimed", stake_id)` | none |
| `price` | `("price", recipient)` | `PriceConfig` |

### Errors

```rust
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Paused = 3,
    BelowMinimum = 4,
    WindowOutOfRange = 5,
    StakeNotFound = 6,
    NotPending = 7,
    DeadlineNotReached = 8,
    TooLate = 9,
    InvalidAmount = 10,
    FeeTooHigh = 11,
}
```

### Storage and state archival

Soroban charges rent and archives entries whose TTL lapses. The contract:

- Stores `Stake` records in **persistent** storage and extends their TTL on every touch, with a ceiling long enough to cover `max_window_secs` plus grace.
- Stores config (admin, oracle, fee) in **instance** storage.
- Exposes the stake's expiry in the `sent` event so the indexer and sweeper know when a stake needs a TTL bump.
- Lets anyone call an `extend_ttl(stake_id)` helper, which is useful for the sweeper.

Terminal-state stakes can be deleted after settlement to reclaim rent. Keep only the events and the off-chain index as the permanent record.

### Invariants (to be enforced by tests)

1. A stake leaves `Pending` at most once.
2. Total USDC held by the contract equals the sum of `Pending` stake amounts.
3. Only the oracle can trigger a refund. Only the recipient (or time) can trigger a payout.
4. `claim` cannot succeed before `deadline + grace`.
5. `confirm_reply` and `claim` are mutually exclusive on the same stake.
6. The fee never exceeds the hard cap (default 5%).
7. Pausing never blocks settlement of existing stakes.

## Reply Detection (the Hard Part)

The contract cannot see Telegram or email, so a trusted **oracle** attests to replies. The design goal is to make that trust narrow, auditable, and eventually replaceable.

### Why not let the recipient attest?

The recipient earns the stake by *not* replying, so a self-attestation is a conflict of interest. Attestation must come from a party that controls the **delivery channel**, which is the Postage platform.

### Telegram flow (MVP)

1. The recipient links their Telegram account by sending `/start <link-token>` to the bot.
2. A sender stakes and submits a message. The backend sends it to the recipient through the bot, with a header like *"Message from Bob, staked 5 USDC"* and buttons for **Reply**, **Spam**, and **Mute sender**.
3. The bot records the Telegram `message_id` of the delivered message.
4. When the recipient uses Telegram's reply feature on that message, the update contains `reply_to_message.message_id`. The adapter matches it to the stake.
5. The adapter applies the **reply validity rules** below. If they pass, it posts a `ReplyEvidence` record to the oracle.
6. The oracle verifies the evidence, signs, and submits `confirm_reply(stake_id)`.
7. The bot relays the recipient's reply back to the sender (in-app, email, or Telegram).

### Email flow

1. For each stake, generate a unique proxy address, e.g. `s_8f3a9c@reply.example.com`.
2. Deliver the message to the recipient's real inbox with `Reply-To` set to the proxy address. The sender's identity is shown in the body.
3. An **inbound parse webhook** (Postmark, Mailgun, SendGrid, or SES + SNS) receives replies to the proxy address.
4. The adapter verifies:
   - the `From` address matches the recipient's registered address,
   - DKIM/SPF/DMARC results pass,
   - `In-Reply-To` / `References` headers match the original `Message-ID`,
   - the message is not an auto-reply (`Auto-Submitted`, `X-Autoreply`, "out of office" heuristics).
5. If valid, the evidence goes to the oracle and the reply is forwarded to the sender.

### Reply validity rules

A trivial reply should not automatically refund the stake, and an auto-responder must never trigger one. Configurable rules include:

| Rule | Default | Purpose |
|---|---|---|
| Minimum length | 1 word | Reject empty or reaction-only replies |
| Auto-reply filter | On | Ignore vacation or bot responses |
| Recipient veto window | 10 minutes | Recipient can press **Not a real reply** before the oracle submits |
| Sender-only replies | On | Reply must come from the recipient's verified identity |
| One refund per stake | Always | Prevents replay |

### Oracle design

**v1: single trusted key.**
- The oracle key lives in a KMS/HSM (AWS KMS, GCP KMS, or a hardware signer), never in the app's environment.
- The oracle only exposes one capability: `confirm_reply` on this contract. Use a dedicated key with minimal XLM funding.
- Every attestation is logged with its evidence hash.

**v2: threshold oracle.**
- Multiple independent signers (platform, a second operator, and optionally the sender) must approve. Implement this as a Stellar multisig account or a Soroban custom account contract that implements `__check_auth`.

**v3: cryptographic evidence.**
- DKIM-signed email proofs, or zk-email style proofs, verified on-chain or by a verifier contract, removing trust in the operator for email replies.

### Sender protections against a dishonest oracle

A malicious or compromised oracle could withhold refunds. Mitigations:

- Public, signed reply logs, so a missing attestation is provable.
- A **dispute** path where the sender submits channel evidence to a governance or multisig arbiter (roadmap).
- Short reply windows with small stakes, which limit exposure per message.

## Backend Services

| Service | Language | Notes |
|---|---|---|
| `api` | TypeScript (Fastify or NestJS) | REST + WebSocket, session auth, sender and recipient flows |
| `bot` | TypeScript (Telegraf) | Delivery, button handling, reply detection |
| `mailer` | TypeScript | Outbound mail and inbound webhook handler |
| `oracle` | TypeScript or Rust | Evidence verification, transaction building and signing |
| `indexer` | TypeScript | Polls Soroban RPC `getEvents`, upserts into Postgres, handles reorg-safe cursors |
| `sweeper` | TypeScript | Cron: finds expired stakes and submits `claim`; bumps TTLs |

### Transaction submission

- Build with `@stellar/stellar-sdk`, simulate with `simulateTransaction` to obtain resource footprints, assemble, sign, submit via `sendTransaction`, and poll `getTransaction`.
- Use a **channel account pool** so the oracle and sweeper can submit in parallel without sequence-number collisions.
- Retry with exponential backoff, and treat `txBAD_SEQ` and resource-limit failures explicitly.

## Database Schema

PostgreSQL. A simplified version:

```sql
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
```

## REST API

Base path `/v1`. Authentication uses Sign-In With Stellar (SEP-10 style challenge, signed by the wallet) and returns a session JWT.

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/challenge` | Get a challenge transaction to sign |
| `POST` | `/auth/verify` | Submit the signed challenge, receive a session |
| `GET` | `/recipients/:handle` | Public profile: price, windows, accepted channels |
| `PUT` | `/me/pricing` | Update price and windows (also calls `set_price` on-chain) |
| `POST` | `/me/channels/telegram/link` | Generate a Telegram deep-link token |
| `POST` | `/me/channels/email` | Register and verify an email address |
| `POST` | `/messages` | Create a message draft and receive an unsigned `send` transaction to sign |
| `POST` | `/messages/:id/submit` | Submit the signed transaction. The message is delivered after on-chain confirmation |
| `GET` | `/messages/:id` | Message and stake status |
| `GET` | `/me/inbox` | Recipient inbox |
| `GET` | `/me/sent` | Sender history |
| `POST` | `/messages/:id/spam` | Recipient flags spam (triggers `flag_spam`) |
| `POST` | `/messages/:id/not-a-reply` | Recipient vetoes a reply inside the veto window |
| `POST` | `/webhooks/telegram` | Telegram updates |
| `POST` | `/webhooks/inbound-email` | Inbound parse events |

## Frontend

Next.js (App Router) with TypeScript and Tailwind.

**Recipient views**
- Onboarding: connect wallet, add a USDC trustline, link Telegram or email, set price.
- Shareable link, such as `postage.app/@alice`.
- Inbox with stake amounts, time left, and **Reply / Spam / Allowlist** actions.
- Earnings dashboard: total claimed, spam caught, reply rate.

**Sender views**
- Compose page showing the price, reply window, and refund rules.
- Stake confirmation with an explicit statement: *"You get 5 USDC back if Alice replies by 12 Oct. Otherwise she keeps it."*
- Stake tracker with live status.

**Wallet support**: Freighter, xBull, Albedo, and others through **Stellar Wallets Kit**. Passkey smart wallets are on the roadmap.

## Wallets, Trustlines and Fee Sponsorship

Wallet friction is the single biggest adoption risk, so the plan addresses it early:

- **Trustlines**: every account that holds USDC needs a trustline. The platform creates and sponsors it using **sponsored reserves** (`BEGIN_SPONSORING_FUTURE_RESERVES`).
- **Fees**: use **fee-bump transactions** so the platform pays network fees. Users never need XLM.
- **Limits**: rate-limit sponsorship per account to prevent abuse.
- **Onramps**: link out to Stellar anchors (SEP-24 / SEP-6) for card and bank funding of USDC.
- **Account abstraction**: Soroban custom accounts and passkeys (secp256r1) enable seedless sign-in. This is a planned upgrade.

## Economics and Fee Model

- **Stake sizing**: typical stakes are 1 to 25 USDC. The aim is a price that costs a spammer real money but is trivial for a serious sender who expects a refund.
- **Protocol fee**: a configurable fee (default 0 to 2%, hard cap 5%) is taken on settlement. Options are to charge it only on refunds, only on claims, or split them.
- **Spam economics**: if a spammer sends N messages at price P and gets a reply rate r, their expected loss is `N × P × (1 − r)`. Recipients are paid for the attention they would otherwise lose.
- **Anti-farming**: a recipient could farm stakes by never replying. Reputation helps here. Public reply-rate stats (`replied / total`) let senders avoid recipients who never answer, and a low rate can reduce discoverability. Recipients with very low reply rates can be warned or delisted.
- **Free passes**: allowlists, verified contacts, and sender-side reputation can reduce or waive stakes.

## Security and Threat Model

| Threat | Mitigation |
|---|---|
| Compromised oracle key | KMS/HSM storage, narrow-scope key, rotation via `set_oracle`, move to threshold signing |
| Malicious oracle withholds refunds | Public signed logs, evidence hashes, dispute path (roadmap), small stakes |
| Recipient farms stakes | Public reply-rate stats, minimum reply expectations, delisting |
| Fake or trivial replies refund spam | Validity rules, recipient veto window, minimum length |
| Auto-responders trigger refunds | Auto-reply header and heuristic filters |
| Sender cancels after delivery | No cancellation after delivery. At most cancel before delivery is confirmed |
| Reentrancy and double settlement | State set before external transfers, status checks, tests for invariants |
| Integer overflow and rounding | Checked math, fee rounding in favor of the sender |
| TTL expiry locking funds | TTL extension on every touch, public `extend_ttl`, sweeper |
| Replay of webhooks | Idempotency keys, per-stake single-refund guarantee |
| Telegram or email spoofing | Verified channel linking, DKIM/SPF/DMARC checks, `reply_to_message` matching |
| Message content leaks | Encrypt at rest, store only a hash on-chain |
| Phishing through the platform | Sender identity display, link scanning, recipient block and mute controls |
| Admin abuse | Admin cannot move user funds, only change fee (capped) and oracle, behind a multisig and timelock |

**Before mainnet**: an independent security audit of the contract, a formal review of the oracle key custody, and a public bug bounty.

## Privacy

- Message bodies are **never** written on-chain, only a SHA-256 hash.
- Message bodies are encrypted at rest with per-message data keys.
- Recipients' real email addresses are never shown to senders when the proxy-address flow is used.
- Stake amounts and the sender and recipient Stellar addresses are public on-chain. Recipients who want to avoid linking their identity to their address can use a dedicated account.
- Retention: delete bodies a configurable number of days after settlement.

## Repository Structure

```
stellar-postage/
├── contracts/
│   └── escrow/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs          # contract entrypoints
│           ├── storage.rs      # keys, TTL helpers
│           ├── types.rs        # Stake, PriceConfig, Status
│           ├── errors.rs
│           └── test.rs         # unit tests
├── apps/
│   ├── web/                    # Next.js frontend
│   └── api/                    # REST + WebSocket backend
├── services/
│   ├── bot/                    # Telegram adapter
│   ├── mailer/                 # Email outbound + inbound
│   ├── oracle/                 # Reply attestation + tx signer
│   ├── indexer/                # Soroban event indexer
│   └── sweeper/                # Expiry claims and TTL bumps
├── packages/
│   ├── sdk/                    # TypeScript client for the contract
│   └── shared/                 # types, validation, constants
├── db/
│   └── migrations/
├── scripts/
│   ├── deploy-testnet.sh
│   └── seed.ts
├── docs/
│   ├── architecture.md
│   ├── oracle.md
│   └── threat-model.md
├── docker-compose.yml
├── .env.example
├── LICENSE
└── README.md
```

## Getting Started

### Prerequisites

- **Rust** (stable) with the `wasm32v1-none` target (or `wasm32-unknown-unknown` on older toolchains)
- **Stellar CLI** (`stellar`)
- **Node.js** 20+ and **pnpm**
- **PostgreSQL** 15+ (or Docker)
- A **Telegram bot token** from [@BotFather](https://t.me/BotFather)
- An inbound email provider account (Postmark, Mailgun, or SendGrid) for the email flow

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/stellar-postage.git
cd stellar-postage
pnpm install
```

### 2. Set up Stellar testnet accounts

```bash
stellar keys generate admin  --network testnet --fund
stellar keys generate oracle --network testnet --fund
stellar keys generate alice  --network testnet --fund   # recipient
stellar keys generate bob    --network testnet --fund   # sender
```

### 3. Get a test USDC

Either use the testnet USDC issuer, or issue your own test asset and wrap it as a Soroban token:

```bash
stellar contract asset deploy \
  --asset USDC:<ISSUER_ADDRESS> \
  --source admin \
  --network testnet
# prints the SAC contract id; save it as USDC_SAC_ID
```

Add trustlines for `alice` and `bob`, and send them some test USDC.

### 4. Build and test the contract

```bash
cd contracts/escrow
cargo test
stellar contract build
```

### 5. Deploy and initialize

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/escrow.wasm \
  --source admin \
  --network testnet
# prints CONTRACT_ID

stellar contract invoke --id $CONTRACT_ID --source admin --network testnet -- \
  initialize \
  --admin $(stellar keys address admin) \
  --oracle $(stellar keys address oracle) \
  --treasury $(stellar keys address admin) \
  --fee_bps 100 \
  --grace_secs 3600
```

### 6. Try a stake end to end from the CLI

```bash
# Alice sets her price: 5 USDC (7 decimals), window 1 hour to 7 days
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet -- \
  set_price --recipient $(stellar keys address alice) \
  --min_amount 50000000 --min_window 3600 --max_window 604800

# Bob stakes
stellar contract invoke --id $CONTRACT_ID --source bob --network testnet -- \
  send --sender $(stellar keys address bob) \
  --recipient $(stellar keys address alice) \
  --token $USDC_SAC_ID --amount 50000000 \
  --msg_hash <32-byte-hex> --window_secs 86400

# The oracle confirms a reply
stellar contract invoke --id $CONTRACT_ID --source oracle --network testnet -- \
  confirm_reply --stake_id 0
```

### 7. Run the services

```bash
cp .env.example .env     # fill in values, see Configuration
docker compose up -d postgres
pnpm db:migrate
pnpm dev                 # starts web, api, bot, oracle, indexer, sweeper
```

For local Telegram webhooks, expose the API with a tunnel (for example, `cloudflared` or `ngrok`) and set the webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://<tunnel>/v1/webhooks/telegram"
```

## Configuration

`.env.example`:

```bash
# Network
STELLAR_NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Contract
ESCROW_CONTRACT_ID=C...
USDC_SAC_ID=C...

# Keys (use KMS in production)
ORACLE_SECRET=S...            # dev only
SPONSOR_SECRET=S...           # pays fees and sponsors reserves
SWEEPER_SECRET=S...

# Database
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postage

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

# Email
MAIL_PROVIDER=postmark
MAIL_API_KEY=
INBOUND_DOMAIN=reply.example.com
INBOUND_WEBHOOK_SECRET=

# App
APP_URL=http://localhost:3000
API_URL=http://localhost:4000
SESSION_SECRET=
MESSAGE_ENCRYPTION_KEY=       # 32 bytes, base64

# Policy
REPLY_VETO_WINDOW_SECS=600
MIN_REPLY_WORDS=1
```

## Testing

### Contract

- **Unit tests** with `soroban-sdk`'s `testutils` using `Env::default()` and `env.mock_all_auths()`, including mock auth checks for the negative cases.
- **Time travel** using `env.ledger().set_timestamp(...)` to test deadlines, grace periods, and the claim vs. confirm race.
- **Token mocks** using `env.register_stellar_asset_contract_v2(admin)` for USDC.
- **Property and fuzz tests** with `proptest` or `cargo-fuzz` for state-machine invariants and fee math.
- **Required cases**: below-minimum stake, window out of range, double confirm, confirm after grace, claim before the deadline, claim after a refund, unauthorized oracle, unauthorized recipient, pause behavior, fee cap, zero and negative amounts.

```bash
cd contracts/escrow && cargo test
```

### Backend and services

```bash
pnpm test             # unit tests
pnpm test:integration # uses a local Stellar quickstart container and a Postgres test DB
```

The **integration suite** runs a full flow against a local Stellar network: deploy, stake, simulated Telegram reply, oracle confirmation, and refund assertion.

### End to end

Playwright tests cover the sender and recipient journeys with a mocked wallet.

## Deployment

1. **Contract**: deploy to testnet, run an extended soak test, then get an audit before mainnet. Consider an upgrade strategy: either immutable, or upgradeable behind a multisig with a timelock.
2. **Infrastructure**: containerize each service. Run `api`, `bot`, and `mailer` stateless behind a load balancer. Run exactly one active `oracle` and `sweeper` (or use leader election).
3. **Secrets**: use a cloud KMS for the oracle key. Never store secret keys in environment variables in production.
4. **Observability**: structured logs, metrics (stake volume, reply rate, settlement latency, oracle errors), and alerts on failed transactions, indexer lag, and unusual refund rates.
5. **Mainnet configuration**: switch the network passphrase and RPC URLs, use the real USDC issuer, and use mainnet-funded sponsor accounts.

## Roadmap

- [ ] **Phase 0: Spec.** Finalize contract interface and threat model.
- [ ] **Phase 1: Contract.** Escrow contract, full test suite, testnet deployment.
- [ ] **Phase 2: Telegram MVP.** Bot, oracle, indexer, sweeper, CLI-driven demo.
- [ ] **Phase 3: Web app.** Recipient setup, sender compose and stake flow, wallet kit, fee sponsorship.
- [ ] **Phase 4: Email.** Proxy addresses, inbound parsing, DKIM-based verification.
- [ ] **Phase 5: Hardening.** Reply validity rules, reputation stats, allowlists, audit, bug bounty.
- [ ] **Phase 6: Mainnet beta.** Invite-only recipients, low stake caps.
- [ ] **Later**
  - Threshold oracle and dispute resolution
  - Passkey smart wallets
  - Zero-knowledge email proofs
  - More channels (Discord, X DMs, LinkedIn, Farcaster, Signal)
  - Browser extension and Gmail plugin
  - Subscription tiers and recipient teams (assistants triaging an inbox)
  - Dynamic pricing based on demand
  - Charity routing: recipients donate claimed stakes automatically
  - Multi-asset stakes

## FAQ

**Why Stellar and Soroban?**
Native USDC, very low fees, roughly 5-second finality, built-in sponsored reserves and fee-bump support (ideal for gasless onboarding), and Rust-based smart contracts with a good testing story.

**Can the recipient cheat by never replying?**
They can keep the stake of any message they ignore, which is the intended spam cost. Reply-rate stats, minimum-engagement signals, and reputation discourage recipients from pricing themselves as a stake farm.

**Can the sender cheat by sending a trivial reply request?**
Only genuine replies by the recipient trigger refunds. The sender cannot attest to anything.

**What if the oracle goes down?**
Stakes stay safe in escrow. The grace period after the deadline gives the oracle time to catch up before any claim is allowed. If the oracle is down for longer, the admin can rotate it.

**What if I replied but the system didn't detect it?**
Replies are matched to the delivered message, so use the Reply feature in Telegram or reply directly to the email. The roadmap includes a dispute path for missed detections.

**Is this legal everywhere?**
It involves stablecoin payments and possibly money-transmission rules that vary by jurisdiction. Get legal advice before any public launch.

## Contributing

Contributions are welcome.

1. Fork the repository and create a feature branch.
2. Keep contract changes small and fully tested, including negative cases.
3. Run `cargo fmt`, `cargo clippy -- -D warnings`, and `pnpm lint` before opening a PR.
4. Describe the problem, the approach, and any security implications in the PR.

Security issues: please **do not** open public issues. Email `devogazi@gmail.com` instead.

## License

MIT. See [LICENSE](./LICENSE).
