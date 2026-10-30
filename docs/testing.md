# Testing Guide

This document describes the testing strategy, test layers, and execution instructions for the **Stellar Postage** codebase.

---

## 1. Testing Architecture & Layers

Stellar Postage enforces rigorous testing across three primary layers:

| Layer                            | Location                             | Tooling                              | Focus                                                                                                                                 |
| -------------------------------- | ------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Contract Invariants**          | `contracts/escrow`                   | Rust, `cargo test`                   | Protocol balance invariants, state transitions (`Pending`, `Refunded`, `Claimed`), authorization, replay protection, fee calculation. |
| **Package & Service Unit Tests** | `packages/*`, `services/*`, `apps/*` | Jest, `ts-jest`, `pg-mem`            | Business logic, adapters, cryptographic hashing, proxy address routing, email parsing, spam filtering, veto windows.                  |
| **End-to-End Integration Suite** | `tests/e2e`                          | Jest, Stellar Quickstart, PostgreSQL | Full cross-service lifecycle against real services with simulated ledger and channel adapters.                                        |

---

## 2. Running Contract Tests

The Soroban smart contract includes unit tests and negative tests for every protocol invariant.

```bash
cd contracts/escrow
cargo test
```

To run contract tests with full output:

```bash
cargo test -- --nocapture
```

---

## 3. Running Unit Tests

Unit tests run across all workspace packages and services:

```bash
# Run unit tests across the entire repository
pnpm test

# Run tests for a specific workspace package
pnpm --filter @stellar-postage/sdk test
pnpm --filter @stellar-postage/mailer test
pnpm --filter @stellar-postage/bot test
pnpm --filter @stellar-postage/oracle test
pnpm --filter @stellar-postage/indexer test
pnpm --filter @stellar-postage/sweeper test
pnpm --filter @stellar-postage/api test
```

---

## 4. End-to-End (E2E) Integration Suite

The integration suite under `tests/e2e` exercises the complete lifecycle across all microservices (`apps/api`, `services/bot`, `services/mailer`, `services/oracle`, `services/indexer`, `services/sweeper`) and the escrow contract.

### Scenarios Covered

1. **Scenario 1: Happy Path (Reply & Refund)**

   - `set_price`: Recipient configures minimum stake amount and response window.
   - `send`: Sender stakes USDC escrow holding funds via SAC.
   - `deliver`: Message relayed to recipient's channel.
   - `reply`: Recipient replies via channel adapter.
   - `veto window elapses`: Veto period elapses without dispute.
   - `oracle confirms`: Oracle verifies evidence and invokes `confirm_reply(stake_id)` on-chain.
   - `sender refunded`: Contract deducts 100 bps protocol fee and refunds remainder to sender; contract balance returns to 0.
   - `indexer shows Refunded`: Event indexer decodes `replied` event, stores in `chain_events`, and marks message `replied`.

2. **Scenario 2: Unanswered/Ignored (Sweeper Claim)**
   - `send`: Sender stakes USDC with response deadline.
   - `ignored`: Recipient does not reply.
   - `deadline + grace passes`: Time advances past deadline plus 1-hour grace period.
   - `sweeper claims`: Sweeper keeper service sweeps expired stakes and invokes `claim(stake_id)`.
   - `recipient paid`: Escrow pays 100% of stake to recipient; contract balance returns to 0.
   - `indexer shows Claimed`: Event indexer decodes `claimed` event and transitions message status to `expired`.

### Running Locally with Docker

To boot the local Stellar Quickstart container and PostgreSQL:

```bash
# 1. Start Docker containers
docker compose -f tests/e2e/docker-compose.e2e.yml up -d

# 2. Verify containers are healthy
docker compose -f tests/e2e/docker-compose.e2e.yml ps

# 3. Build packages
pnpm build

# 4. Run the integration test suite
pnpm --filter @stellar-postage/e2e test:integration
```

To tear down containers when done:

```bash
docker compose -f tests/e2e/docker-compose.e2e.yml down -v
```

### Running in Local / Sandbox Mode (Without Docker)

The integration suite is dual-mode. If Docker is not available in your environment, `tests/e2e/src/environment.ts` automatically initializes:

- In-memory PostgreSQL instance powered by `pg-mem` with UUID extension emulation.
- In-memory Soroban RPC and ledger state machine tracking exact token balances, stake records, and on-chain event streams.

You can run the suite directly:

```bash
pnpm --filter @stellar-postage/e2e test
# or root shortcut
pnpm test:integration
```

---

## 5. CI / CD Workflow

Integration tests are separated into a dedicated GitHub Actions workflow:

- **File**: `.github/workflows/e2e.yml`
- **Triggers**: Pushes and PRs touching `contracts/**`, `apps/**`, `services/**`, `packages/**`, or `tests/**`.
- **Environment**: Boots PostgreSQL and `stellar/quickstart:testing`, builds workspace artifacts, and executes `pnpm test:integration`.
