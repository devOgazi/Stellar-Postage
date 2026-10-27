#!/usr/bin/env bash
# scripts/deploy-testnet.sh
# Follows README "Getting Started" steps 2 to 5:
#   Step 2: Generate and fund keys (admin, oracle, alice, bob)
#   Step 3: Deploy USDC SAC wrapper for a configurable asset
#   Step 4: Build the escrow contract
#   Step 5: Deploy and initialize with values from .env
#
# Idempotent: reuses existing keys and deployed contracts if present.
# Prints CONTRACT_ID and USDC_SAC_ID, and writes them to .env.deployed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

# Load existing environment configuration if present
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^#' "$ROOT/.env" | grep -v '^\s*$')
  set +a
fi

if [ -f "$ROOT/.env.deployed" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^#' "$ROOT/.env.deployed" | grep -v '^\s*$')
  set +a
fi

STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"

echo "=========================================================="
echo "Stellar Postage – Testnet Deployment"
echo "Network: $STELLAR_NETWORK"
echo "=========================================================="

# -----------------------------------------------------------------------------
# Step 2: Set up Stellar testnet accounts
# -----------------------------------------------------------------------------
echo "==> Step 2: Ensuring testnet accounts exist and are funded..."
ACCOUNTS=("admin" "oracle" "alice" "bob")
for name in "${ACCOUNTS[@]}"; do
  if stellar keys address "$name" >/dev/null 2>&1; then
    addr="$(stellar keys address "$name")"
    echo "    Account '$name' already exists: $addr"
  else
    echo "    Generating and funding '$name'..."
    stellar keys generate "$name" --network "$STELLAR_NETWORK" --fund
    addr="$(stellar keys address "$name")"
    echo "    Created and funded '$name': $addr"
  fi
done

ADMIN_ADDR="$(stellar keys address admin)"
ORACLE_ADDR="$(stellar keys address oracle)"
ALICE_ADDR="$(stellar keys address alice)"
BOB_ADDR="$(stellar keys address bob)"

# -----------------------------------------------------------------------------
# Step 3: Get/deploy test USDC (SAC wrapper)
# -----------------------------------------------------------------------------
echo "==> Step 3: Setting up USDC Stellar Asset Contract (SAC)..."
if [ -n "${USDC_SAC_ID:-}" ]; then
  echo "    Using existing USDC_SAC_ID: $USDC_SAC_ID"
else
  # Configurable asset: default to USDC issued by admin
  if [ -n "${USDC_ASSET:-}" ]; then
    ASSET_TARGET="$USDC_ASSET"
  elif [ -n "${USDC_ISSUER:-}" ]; then
    ASSET_TARGET="USDC:$USDC_ISSUER"
  else
    ASSET_TARGET="USDC:$ADMIN_ADDR"
  fi

  echo "    Deploying SAC wrapper for asset $ASSET_TARGET..."
  USDC_SAC_ID=$(stellar contract asset deploy \
    --asset "$ASSET_TARGET" \
    --source admin \
    --network "$STELLAR_NETWORK")
  echo "    Deployed USDC SAC: $USDC_SAC_ID"
fi

# Mint test USDC to bob so he has funds to stake
echo "    Funding Bob with test USDC..."
stellar contract invoke --id "$USDC_SAC_ID" --source admin --network "$STELLAR_NETWORK" -- \
  mint --to "$BOB_ADDR" --amount 10000000000 >/dev/null 2>&1 || true

# -----------------------------------------------------------------------------
# Step 4: Build contract
# -----------------------------------------------------------------------------
echo "==> Step 4: Building escrow contract..."
(cd "$ROOT/contracts/escrow" && stellar contract build)

WASM="$ROOT/contracts/escrow/target/wasm32v1-none/release/escrow.wasm"
if [ ! -f "$WASM" ]; then
  WASM="$ROOT/contracts/escrow/target/wasm32-unknown-unknown/release/escrow.wasm"
fi

if [ ! -f "$WASM" ]; then
  echo "Error: Could not locate compiled escrow.wasm at $WASM" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Step 5: Deploy and initialize
# -----------------------------------------------------------------------------
echo "==> Step 5: Deploying and initializing escrow contract..."
if [ -n "${ESCROW_CONTRACT_ID:-}" ] && [ -z "${FORCE_REDEPLOY:-}" ]; then
  CONTRACT_ID="$ESCROW_CONTRACT_ID"
  echo "    Using existing ESCROW_CONTRACT_ID: $CONTRACT_ID"
else
  CONTRACT_ID=$(stellar contract deploy \
    --wasm "$WASM" \
    --source admin \
    --network "$STELLAR_NETWORK")
  echo "    Deployed Escrow Contract: $CONTRACT_ID"

  FEE_BPS="${FEE_BPS:-100}"
  GRACE_SECS="${GRACE_SECS:-3600}"
  TREASURY_ADDR="${TREASURY_ADDR:-$ADMIN_ADDR}"

  echo "    Calling initialize..."
  stellar contract invoke --id "$CONTRACT_ID" --source admin --network "$STELLAR_NETWORK" -- \
    initialize \
    --admin "$ADMIN_ADDR" \
    --oracle "$ORACLE_ADDR" \
    --treasury "$TREASURY_ADDR" \
    --fee_bps "$FEE_BPS" \
    --grace_secs "$GRACE_SECS"
fi

# -----------------------------------------------------------------------------
# Print and save identifiers
# -----------------------------------------------------------------------------
echo "=========================================================="
echo "Deployment Finished Successfully!"
echo "CONTRACT_ID=$CONTRACT_ID"
echo "USDC_SAC_ID=$USDC_SAC_ID"
echo "=========================================================="

DEPLOYED_FILE="$ROOT/.env.deployed"
cat <<EOF > "$DEPLOYED_FILE"
# Generated by scripts/deploy-testnet.sh
CONTRACT_ID=$CONTRACT_ID
ESCROW_CONTRACT_ID=$CONTRACT_ID
USDC_SAC_ID=$USDC_SAC_ID
STELLAR_NETWORK=$STELLAR_NETWORK
EOF

echo "Saved deployed variables to $DEPLOYED_FILE"
