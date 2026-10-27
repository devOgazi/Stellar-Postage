#!/usr/bin/env bash
# scripts/e2e-cli.sh
# Reproduces README Step 6:
#   1. Alice sets her price: 5 USDC, window 1 hour to 7 days
#   2. Bob stakes 5 USDC with off-chain message hash
#   3. Oracle confirms reply
# Prints balances before and after each step.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

# Load deployed IDs
if [ -f "$ROOT/.env.deployed" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^#' "$ROOT/.env.deployed" | grep -v '^\s*$')
  set +a
elif [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^#' "$ROOT/.env" | grep -v '^\s*$')
  set +a
fi

CONTRACT_ID="${CONTRACT_ID:-${ESCROW_CONTRACT_ID:-}}"
USDC_SAC_ID="${USDC_SAC_ID:-}"
STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"

if [ -z "$CONTRACT_ID" ] || [ -z "$USDC_SAC_ID" ]; then
  echo "Error: CONTRACT_ID and USDC_SAC_ID must be set. Run scripts/deploy-testnet.sh first." >&2
  exit 1
fi

ALICE_ADDR="$(stellar keys address alice)"
BOB_ADDR="$(stellar keys address bob)"

get_balance() {
  local account_id="$1"
  stellar contract invoke --id "$USDC_SAC_ID" --source admin --network "$STELLAR_NETWORK" -- \
    balance --id "$account_id" 2>/dev/null | tr -d '"' || echo "0"
}

echo "=========================================================="
echo "Stellar Postage – E2E CLI Walkthrough"
echo "Escrow Contract: $CONTRACT_ID"
echo "USDC SAC ID:     $USDC_SAC_ID"
echo "Network:         $STELLAR_NETWORK"
echo "=========================================================="

echo "==> Initial Balances:"
echo "    Bob (sender):      $(get_balance "$BOB_ADDR") stroops"
echo "    Alice (recipient): $(get_balance "$ALICE_ADDR") stroops"
echo "    Contract Escrow:   $(get_balance "$CONTRACT_ID") stroops"

echo ""
echo "==> Step 6a: Alice sets her price (5 USDC = 50,000,000 stroops, window 1h to 7d)..."
stellar contract invoke --id "$CONTRACT_ID" --source alice --network "$STELLAR_NETWORK" -- \
  set_price \
  --recipient "$ALICE_ADDR" \
  --min_amount 50000000 \
  --min_window 3600 \
  --max_window 604800

echo ""
echo "==> Step 6b: Bob stakes 5 USDC for Alice..."
MSG_PAYLOAD="Hello Alice, I would love to discuss a project with you."
MSG_HASH="$(echo -n "$MSG_PAYLOAD" | sha256sum | awk '{print $1}')"

STAKE_ID=$(stellar contract invoke --id "$CONTRACT_ID" --source bob --network "$STELLAR_NETWORK" -- \
  send \
  --sender "$BOB_ADDR" \
  --recipient "$ALICE_ADDR" \
  --token "$USDC_SAC_ID" \
  --amount 50000000 \
  --msg_hash "$MSG_HASH" \
  --window_secs 86400 | tr -d '"')

echo "    Created stake ID: $STAKE_ID"

echo ""
echo "==> Balances after stake creation (funds locked in escrow):"
echo "    Bob (sender):      $(get_balance "$BOB_ADDR") stroops"
echo "    Alice (recipient): $(get_balance "$ALICE_ADDR") stroops"
echo "    Contract Escrow:   $(get_balance "$CONTRACT_ID") stroops"

echo ""
echo "==> Step 6c: Oracle confirms reply for stake $STAKE_ID..."
stellar contract invoke --id "$CONTRACT_ID" --source oracle --network "$STELLAR_NETWORK" -- \
  confirm_reply \
  --stake_id "$STAKE_ID"

echo ""
echo "==> Final Balances after confirmation (refunded to Bob minus fee):"
echo "    Bob (sender):      $(get_balance "$BOB_ADDR") stroops"
echo "    Alice (recipient): $(get_balance "$ALICE_ADDR") stroops"
echo "    Contract Escrow:   $(get_balance "$CONTRACT_ID") stroops"
echo "=========================================================="
echo "E2E Walkthrough Completed Successfully!"
