# Contributing to Stellar Postage

Thank you for your interest in contributing to **Stellar Postage**!

Before contributing, please read **[README.md](./README.md)** in full. The README is the single source of truth for protocol architecture, naming conventions, scope boundaries, database schemas, and security invariants.

---

## 1. Development Setup & Prerequisites

Ensure the following tools are installed on your machine:

- **Node.js**: `v20.x` or higher
- **pnpm**: `v9.x` or higher (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Rust**: Stable toolchain with WebAssembly compilation target:
  ```bash
  rustup target add wasm32v1-none
  # or on older toolchains:
  rustup target add wasm32-unknown-unknown
  ```
- **Stellar CLI**:
  ```bash
  cargo install --locked stellar-cli
  ```
- **Docker & Docker Compose**: For local PostgreSQL and Stellar Quickstart containers.

### Initializing the Workspace

```bash
git clone https://github.com/devogazi/stellar-postage.git
cd stellar-postage
pnpm install
pnpm build
```

---

## 2. Branching & Git Workflow

1. Fork the repository on GitHub.
2. Create a topical feature branch branching off `main`:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```
3. Keep changes atomic, focused, and reviewable.
4. Open a Pull Request targeting `main`.

---

## 3. Commit Guidelines (Conventional Commits)

All commit messages must adhere to the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification:

```
<type>(<scope>): <short description in imperative present tense>

[optional body explaining problem and approach]

[optional footer(s)]
```

### Allowed Types

- `feat`: A new feature or capability.
- `fix`: A bug fix.
- `docs`: Documentation updates or additions.
- `test`: Adding or updating test suites.
- `refactor`: Code change that neither fixes a bug nor adds a feature.
- `perf`: Performance improvements.
- `chore`: Tooling, build pipeline, or dependency updates.

### Examples

- `feat(mailer): implement email channel with postmark adapter`
- `fix(indexer): handle rpc retention window limit gracefully`
- `test(e2e): add end-to-end integration suite with quickstart container`
- `docs: update architecture runbooks and threat model`

---

## 4. Testing & Verification Requirements

Every change must ship with comprehensive tests:

### 4.1 Smart Contract Changes (`contracts/escrow`)

- **Negative Tests Required**: Every validation branch, access-control check, and boundary condition must be accompanied by explicit negative tests verifying the typed `Error` enum code (e.g., `Error::BelowMinimum`, `Error::WindowOutOfRange`, `Error::NotPending`).
- **Invariant Mapping**: Every contract invariant documented in the README must map directly to at least one unit or property test:
  1. A stake leaves `Pending` at most once.
  2. Total USDC held by contract equals sum of `Pending` stakes.
  3. Only the oracle can trigger a refund; only recipient or time can trigger a payout.
  4. `claim` cannot succeed before `deadline + grace`.
  5. `confirm_reply` and `claim` are mutually exclusive.
  6. Protocol fee never exceeds hard cap (5%).
  7. Pausing never blocks settlement of existing stakes.
- **No Unhandled Panics**: Use typed `#[contracterror]` errors, never `panic!` or bare `assert!` in production paths.
- **Verification Commands**:
  ```bash
  cd contracts/escrow
  cargo test
  cargo clippy -- -D warnings
  cargo fmt -- --check
  ```

### 4.2 TypeScript & Microservice Changes

- Follow strict TypeScript guidelines (`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`).
- Run the full test and linting pipeline:
  ```bash
  pnpm lint
  pnpm typecheck
  pnpm test
  ```

### 4.3 End-to-End Integration Tests

- Run the integration suite before submitting PRs that affect cross-service communication:
  ```bash
  pnpm test:integration
  ```
- See **[docs/testing.md](./docs/testing.md)** for details on running with Docker Quickstart containers.

---

## 5. README Alignment Notes (Mandatory for PRs)

Every PR must include a dedicated **README Alignment Check** section:

- List every README section, function name, API route, table name, or environment variable touched by your work.
- Confirm that your code exactly matches the specifications in `README.md`.
- If a change requires updating or adjusting the README, explain why and propose minimal, explicit README edits. Do not silently diverge.

---

## 6. Security Vulnerabilities

**Do not file public GitHub issues for security vulnerabilities.**

Please report any security issues privately to:
📧 **`devogazi@gmail.com`**

See **[SECURITY.md](./SECURITY.md)** for our complete coordinated disclosure and security response policy.

---

## 7. Code of Conduct

All contributors and participants are expected to adhere to our **[Code of Conduct](./CODE_OF_CONDUCT.md)**.
