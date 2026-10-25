#!/usr/bin/env bash
# deploy-testnet.sh – deploy the escrow contract to Stellar testnet.
# Prerequisites: stellar CLI installed, testnet keys generated (see README).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

echo "==> Building contract..."
(cd "$ROOT/contracts/escrow" && stellar contract build)

WASM="$ROOT/contracts/escrow/target/wasm32v1-none/release/escrow.wasm"

echo "==> Deploying to testnet..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source admin \
  --network testnet)

echo "CONTRACT_ID=$CONTRACT_ID"

echo "==> Initializing contract..."
stellar contract invoke --id "$CONTRACT_ID" --source admin --network testnet -- \
  initialize \
  --admin "$(stellar keys address admin)" \
  --oracle "$(stellar keys address oracle)" \
  --treasury "$(stellar keys address admin)" \
  --fee_bps 100 \
  --grace_secs 3600

echo "==> Done. Add to .env: ESCROW_CONTRACT_ID=$CONTRACT_ID"
