# Deployment and CLI Testing Guide

This guide documents the procedures for deploying the Stellar Postage escrow contract to Stellar testnet and verifying it using CLI walkthrough scripts.

## Prerequisites

1. **Rust Toolchain**: Stable Rust with the `wasm32v1-none` (or `wasm32-unknown-unknown`) target.
2. **Stellar CLI**: Installed and available in `$PATH` (`stellar --version`).
3. **Network Connectivity**: Access to the Stellar testnet RPC and friendbot.
4. **Environment Configuration**: Optional `.env` file for custom configuration (fee, grace period, network).

> [!NOTE]
> No secret keys or credentials are hardcoded. Stellar accounts are managed securely through the `stellar keys` identity system.

---

## 1. Testnet Deployment (`scripts/deploy-testnet.sh`)

The `scripts/deploy-testnet.sh` script automates steps 2 through 5 of the README "Getting Started" guide:

1. **Step 2: Generate and Fund Accounts**:
   - Checks for the existence of `admin`, `oracle`, `alice`, and `bob` identities.
   - Generates and funds any missing identities using friendbot on testnet.
2. **Step 3: Deploy USDC SAC Wrapper**:
   - Deploys the Stellar Asset Contract (SAC) for a configurable asset (defaults to `USDC:<admin_address>`).
   - Mints initial test USDC to `bob` (the sender) to fund test stakes.
3. **Step 4: Contract Build**:
   - Builds the Soroban smart contract in `contracts/escrow` using `stellar contract build`.
4. **Step 5: Deploy and Initialize**:
   - Deploys the compiled WebAssembly artifact (`escrow.wasm`) to testnet.
   - Invokes `initialize(admin, oracle, treasury, fee_bps, grace_secs)` using values configured from `.env` (defaults: `fee_bps=100`, `grace_secs=3600`).
5. **Output and Persistence**:
   - Prints `CONTRACT_ID` and `USDC_SAC_ID`.
   - Writes the variables to `.env.deployed` (which is gitignored) for subsequent scripts.

### Running the Deployment

```bash
./scripts/deploy-testnet.sh
```

### Idempotency

- If keys already exist in the local Stellar config, they are reused rather than overwritten.
- If `USDC_SAC_ID` or `ESCROW_CONTRACT_ID` are already set in `.env` or `.env.deployed`, the script skips redundant redeployments unless `FORCE_REDEPLOY=1` is provided.

---

## 2. End-to-End CLI Testing (`scripts/e2e-cli.sh`)

The `scripts/e2e-cli.sh` script reproduces Step 6 from the README, validating the core stake-refund lifecycle end-to-end:

1. **Pre-flight Checks**:
   - Loads `CONTRACT_ID` and `USDC_SAC_ID` from `.env.deployed` or `.env`.
   - Queries and prints initial USDC balances for Bob (sender), Alice (recipient), and the contract escrow.
2. **Step 6a: Recipient Pricing (`set_price`)**:
   - Alice sets her price: 5 USDC (`50,000,000` base units) and reply window (1 hour to 7 days).
3. **Step 6b: Message Stake Creation (`send`)**:
   - Computes SHA-256 hash of an off-chain message body.
   - Bob invokes `send` to lock 5 USDC in escrow.
   - Prints balances showing the funds transferred into the contract.
4. **Step 6c: Oracle Reply Attestation (`confirm_reply`)**:
   - Oracle invokes `confirm_reply` for the created stake ID.
   - Prints final balances demonstrating:
     - Sender (Bob) is refunded the stake minus the 1% protocol fee.
     - Contract escrow balance returns to 0.

### Running the E2E CLI Walkthrough

```bash
./scripts/e2e-cli.sh
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `STELLAR_NETWORK` | Target network (`testnet` or `local`) | `testnet` |
| `USDC_ASSET` | Asset identifier for SAC wrapper | `USDC:<admin_address>` |
| `FEE_BPS` | Protocol fee in basis points (capped at 500) | `100` (1%) |
| `GRACE_SECS` | Grace period after deadline before claims | `3600` (1 hour) |
| `TREASURY_ADDR` | Address receiving protocol fees | `admin` address |
