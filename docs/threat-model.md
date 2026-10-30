# Comprehensive Threat Model

This document expands the **Security and Threat Model** summary in `README.md` §14 into an exhaustive analysis of attack vectors, protocol invariants, trust boundaries, and mitigations.

---

## 1. System Trust Boundaries

```
[ Sender Client / Wallet ]
       │
═══════╪═════════════════════════════════════════════════════════════ Untrusted Boundary
       │  (HTTPS / SEP-10 Auth)
       ▼
[ Backend API / Database ] ◄───► [ Channel Adapters (Telegram / Email) ]
       │                                     │
═══════╪═════════════════════════════════════╪═══════════════════════ Semi-Trusted Boundary
       ▼                                     ▼
[ Soroban RPC / Node ] ◄── [ Oracle KMS ] ───┘
       │
═══════╪═════════════════════════════════════════════════════════════ Trustless Settlement
       ▼
[ Soroban Escrow Contract ] ── holds ──► [ USDC SAC (Stellar Asset Contract) ]
```

The system operates across three trust domains:

1. **Trustless Settlement**: The Soroban smart contract enforces balance conservation, state transitions, and timing constraints deterministically on the Stellar blockchain.
2. **Semi-Trusted Infrastructure**: The Oracle Service and Channel Adapters observe real-world communications and attest to valid replies.
3. **Untrusted External Clients**: Senders, recipients, email servers, and web clients who may act adversarially.

---

## 2. Threat Analysis & Mitigations

### 2.1 Compromised Oracle Key

- **Threat**: An attacker acquires the private key used to sign `confirm_reply()`.
- **Attack Vector**: Attacker calls `confirm_reply` on pending stakes to refund senders fraudulently before recipients can claim.
- **Impact**: Senders receive unexpected refunds; recipients lose legitimate spam payouts. Contract cannot be drained because refunds can only transfer back to original senders.
- **Mitigations**:
  - The oracle key lives in an HSM / Cloud KMS (AWS KMS, GCP Cloud KMS, Vault HSM); key material is never exposed in software environments.
  - The oracle account holds only minimal gas funding (~2 to 5 XLM) and lacks any administrative capabilities.
  - The admin account can immediately execute `set_oracle(new_key)` to replace the compromised key without pausing the contract.
  - Emergency `pause()` stops new incoming stakes while investigation and rotation occur.

### 2.2 Malicious or Offline Oracle Withholding Refunds

- **Threat**: The oracle operator goes offline or refuses to attest to a genuine reply.
- **Attack Vector**: Sender stakes funds, recipient replies honestly, but no `confirm_reply()` is submitted.
- **Impact**: If unmitigated, after `deadline + grace_secs`, the stake becomes claimable by the sweeper, penalizing an honest sender.
- **Mitigations**:
  - The contract enforces a **1-hour grace period** (`grace_secs = 3600`) after `deadline`. Even if an oracle experiences a temporary outage, stakes cannot be swept before the grace period ends.
  - All verified reply events produce immutable `reply_evidence` records in PostgreSQL with cryptographic SHA-256 digests. Missing attestations are auditable and provable.
  - Senders can choose short windows and low stake amounts ($1–$25 USDC), bounding risk per transaction.

### 2.3 Recipient Farming Stakes (Attention Traps)

- **Threat**: A high-profile recipient advertises a Postage inbox with high minimum stakes, never intends to reply, and systematically collects all stakes via `claim()`.
- **Attack Vector**: Senders submit legitimate messages expecting engagement, but 100% of stakes lapse and are collected by the recipient.
- **Impact**: Degrades platform utility and sender trust.
- **Mitigations**:
  - The API and UI publish transparent **Recipient Reply Rates** (`replied_count / total_delivered`) and median response times.
  - Senders see historical response metrics before staking USDC.
  - Accounts with consistently abusive non-response patterns are delisted from the discovery directory.

### 2.4 Fake or Trivial Replies Refunding Spam

- **Threat**: A sender and recipient collude, or a recipient submits a trivial reaction (e.g., an emoji or space) to refund a spam stake.
- **Attack Vector**: Sender blasts messages; recipient sends automated 1-character replies to clear the stake.
- **Impact**: Circumvents spam resistance.
- **Mitigations**:
  - **Minimum Word Count**: Replies require at least one alphanumeric word (ignoring punctuation and whitespace).
  - **Auto-Reply Heuristics**: Headers like `Auto-Submitted`, `X-Autoreply`, and vacation patterns are strictly rejected.
  - **Recipient Veto Window**: Recipient is granted a 10-minute veto window after replying to click **"Not a real reply"** in the UI or Telegram bot, halting oracle submission.

### 2.5 Auto-Responders Triggering Refunds

- **Threat**: An automated email vacation responder or bot reply is misinterpreted as an honest reply, refunding the sender's stake.
- **Attack Vector**: Spammer targets recipients who have vacation auto-replies enabled.
- **Impact**: Spammer reaches the inbox at zero net cost.
- **Mitigations**:
  - Mailer adapter parses headers for `Auto-Submitted: auto-replied`, `Auto-Submitted: auto-generated`, and `X-Autoreply: yes`.
  - Body heuristic filter checks for common phrases: "out of office", "away from my desk", "auto-reply", "vacation responder".
  - If detected, inbound email is classified as non-qualifying and discarded from oracle forwarding.

### 2.6 Sender Cancels After Delivery

- **Threat**: A sender stakes funds, the recipient reads the message, and the sender cancels the stake before the recipient can reply.
- **Attack Vector**: Sender calls a cancellation function once the message reaches the recipient's eyes.
- **Impact**: Senders gain free attention without risk.
- **Mitigations**:
  - **Core Invariant**: The contract has **no sender cancellation mechanism**. Once `send()` locks funds in escrow, funds can _only_ move via `confirm_reply`, `flag_spam`, or `claim`. Senders cannot unilaterally recall funds under any circumstances.

### 2.7 Reentrancy and Double Settlement

- **Threat**: An attacker triggers concurrent or recursive executions of `confirm_reply()` and `claim()`.
- **Attack Vector**: Race conditions between oracle confirmation and keeper sweeper.
- **Impact**: Double payout or draining contract reserves.
- **Mitigations**:
  - **Checks-Effects-Interactions Pattern**: In the smart contract, `stake.status` is checked (`assert!(stake.status == Status::Pending)`) and immediately transitioned to `Refunded` or `Claimed` before initiating any token transfer.
  - A stake leaves `Pending` at most once (enforced by invariant tests).
  - Protocol fees are split and transferred within the same atomic Soroban transaction.

### 2.8 Integer Overflow and Rounding Manipulation

- **Threat**: Extreme stake values or micro-stakes cause arithmetic overflow or rounding theft.
- **Attack Vector**: Submitting stakes with $10^{18}$ base units or $1$ stroop to manipulate fee splits.
- **Impact**: Contract panics or fees round down to 0 while stealing basis points.
- **Mitigations**:
  - All token amounts use checked `i128` arithmetic.
  - Minimum stake validation: `amount >= price.min_amount` and `amount > 0`.
  - Fee calculation:
    $$\text{fee} = \frac{\text{amount} \times \text{fee\_bps}}{10000}$$
    $$\text{to\_sender} = \text{amount} - \text{fee}$$
  - Integer division truncation naturally favors the sender (the protocol fee rounds down, never up).

### 2.9 Storage Expiry and State Archival (Soroban TTL)

- **Threat**: A long-running stake (e.g., 30-day window) has its ledger entry archived by Soroban rent collectors before settlement.
- **Attack Vector**: Network state archival prevents `claim()` or `confirm_reply()`.
- **Impact**: Stake funds locked in the contract address with no live ledger entry to execute the payout.
- **Mitigations**:
  - Stakes are written to **persistent storage**.
  - Every contract interaction automatically extends entry TTL to cover `max_window_secs + grace_secs`.
  - A public permissionless `extend_ttl(stake_id)` entrypoint allows anyone (specifically the Sweeper service) to refresh entry lifetime before archival occurs.

### 2.10 Webhook Replay Attacks

- **Threat**: An adversary intercepts or captures inbound Telegram or Postmark webhooks and replays them to trigger multiple actions.
- **Attack Vector**: Replaying `POST /v1/webhooks/inbound-email`.
- **Impact**: False positive replies or denial of service.
- **Mitigations**:
  - Postmark webhook secret verification (`INBOUND_WEBHOOK_SECRET`) via custom authorization headers.
  - Idempotency key tracking in Redis/Postgres on external message identifiers.
  - On-chain status check: only one refund is possible per stake.

### 2.11 Telegram and Email Spoofing

- **Threat**: Attacker sends a forged email or Telegram update claiming to be the recipient.
- **Attack Vector**: Sending an SMTP message with a forged `From: alice@example.com` to the proxy address.
- **Impact**: Unauthorized refund.
- **Mitigations**:
  - Telegram: Verified linking matches the numerical `chat.id` and `from.id` authenticated by BotFather.
  - Email: Inbound parser strictly enforces SPF (`pass`), DKIM (`pass`), and DMARC (`pass`). Any failed or neutral validation causes immediate rejection.
  - Threading: Email replies must present matching `In-Reply-To` and `References` headers referencing the outbound `Message-ID`.

### 2.12 Message Privacy and Plaintext Leakage

- **Threat**: Node operators, RPC observers, or database intruders inspect confidential message contents.
- **Attack Vector**: Reading ledger transactions or dumping Postgres tables.
- **Impact**: Confidentiality breach of cold pitch contents.
- **Mitigations**:
  - **Zero On-Chain Plaintext**: Only a SHA-256 hash `msg_hash` is written to the blockchain.
  - **Database Encryption**: Message bodies are encrypted with AES-256-GCM using a server-side encryption key (`MESSAGE_ENCRYPTION_KEY`).
  - **Retention Limits**: Decrypted message bodies are scheduled for purge after settlement.

---

## 3. Pre-Mainnet Security Checklist

Prior to production mainnet deployment, the following activities are strictly required:

1. **Smart Contract Audit**: Formal audit by an accredited Stellar/Rust security firm focusing on Soroban storage models, auth requirements, and fee mathematics.
2. **KMS / HSM Architecture Review**: External review of oracle signing infrastructure and IAM least-privilege policies.
3. **Bug Bounty Program**: Public bug bounty covering contract invariants and channel adapter webhooks.
