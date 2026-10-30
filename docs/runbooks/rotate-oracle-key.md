# Runbook: Rotating the Oracle Key

## 1. Overview & Triggers

This runbook describes the procedure to rotate the active Oracle signing key in the Stellar Postage escrow contract.

**Triggers**:

- Routine key rotation policy (e.g., quarterly or semi-annual rotation).
- Upgrading from a software test key to a hardware KMS key.
- Revoking an operator credential after an infrastructure change.
- Responding to an emergency or suspected key compromise (see also: [Oracle Compromise Incident](./oracle-compromise-incident.md)).

---

## 2. Invariants & Authority

- **Contract Function**: `set_oracle(new_oracle: Address)`
- **Caller Requirement**: The contract `Admin` (`require_auth`).
- **Safety Guarantee**: Key rotation does not impact existing stakes in escrow or interrupt contract settlement. Unconfirmed stakes will simply be confirmed by the new oracle key once rotated.

---

## 3. Pre-Rotation Checklist

1. Ensure access to the contract `Admin` secret key or admin multisig signer.
2. Confirm current contract address (`ESCROW_CONTRACT_ID`) on the active network.
3. Provision the new Ed25519 keypair in AWS KMS, GCP Cloud KMS, or Vault HSM.
4. Note the new public address (e.g., `GNEWORACLE...`).
5. Ensure the new Oracle account is funded with minimum reserve XLM (~2 to 5 XLM) on Stellar.

---

## 4. Step-by-Step Procedure

### Step 1: Fund the New Oracle Account

Fund the newly generated Oracle address with base reserve:

```bash
stellar keys fund GNEWORACLE... --network <network>
```

### Step 2: Invoke `set_oracle` on the Escrow Contract

Using the `stellar` CLI with the admin key:

```bash
stellar contract invoke \
  --id $ESCROW_CONTRACT_ID \
  --source admin \
  --network <network> \
  -- \
  set_oracle \
  --new_oracle GNEWORACLE...
```

Verify that the transaction succeeds and produces a successful return value (`Void`).

### Step 3: Verify the On-Chain Configuration

Read the contract instance storage to verify the active Oracle address:

```bash
# Query contract instance storage or call fetch via SDK
node -e "
  import { EscrowClient } from '@stellar-postage/sdk';
  // verify client reads new oracle address
"
```

### Step 4: Update the Oracle Service Configuration

Update the Oracle service environment configuration:

```bash
# In production environment or secret manager:
ORACLE_KMS_KEY_ID="projects/.../cryptoKeys/new-oracle-key"
# or for local/testnet:
ORACLE_SECRET="SNEWORACLE..."
```

### Step 5: Deploy / Restart the Oracle Service

Perform a rolling restart of the Oracle service:

```bash
docker compose restart oracle
# or kubernetes rollout:
kubectl rollout restart deployment/oracle-service
```

### Step 6: Verify Settlement Telemetry

Monitor Oracle application logs for the first successful attestation:

```bash
docker compose logs -f oracle | grep "confirm_reply"
```

Verify that the transaction confirms on-chain without authorization failures (`HostError: Error(Auth, InvalidAction)`).

### Step 7: Decommission Old Oracle Key

1. Drain remaining XLM from the old Oracle account back to the operational treasury.
2. Disable or archive the old key in Cloud KMS / HSM.
