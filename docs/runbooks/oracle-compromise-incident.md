# Runbook: Incident Response for Suspected Oracle Key Compromise

## 1. Incident Classification & Severity

- **Incident Type**: Compromised Private Key / Unauthorized Attestation.
- **Severity**: **P0 (Critical)**.
- **Trigger**: Unauthorized `confirm_reply` transactions observed on-chain, anomalous Cloud KMS signing metrics, leaked service credentials, or intrusion alert on the Oracle service host.

---

## 2. Blast Radius Assessment

Because the escrow contract enforces strict state machine rules:

- **What the Attacker CANNOT Do**:
  - The attacker CANNOT drain escrow funds to their own address. `confirm_reply` strictly transfers funds back to the original `stake.sender` (with fee to treasury).
  - The attacker CANNOT steal recipient balances or alter fees.
- **What the Attacker CAN Do**:
  - Prematurely refund pending stakes to senders before recipients have a chance to claim or flag spam.

---

## 3. Emergency Response Procedure (Target: < 5 Minutes)

### Phase 1: Immediate Containment (T+0 to T+5 min)

#### 1. Pause the Contract

Prevent any new funds from entering escrow by halting `send()`:

```bash
stellar contract invoke \
  --id $ESCROW_CONTRACT_ID \
  --source admin \
  --network <network> \
  -- \
  pause
```

#### 2. Revoke Oracle KMS Credentials / Disable Key

- **AWS KMS**: Disable the key immediately:
  ```bash
  aws kms disable-key --key-id <ORACLE_KMS_KEY_ID>
  ```
- **GCP Cloud KMS**: Disable the active key version:
  ```bash
  gcloud kms keys versions disable 1 --key <KEY_NAME> --keyring <RING> --location <LOCATION>
  ```
- **Local / Software Key**: Revoke API keys and stop the container:
  ```bash
  docker compose stop oracle
  ```

---

### Phase 2: Key Replacement & Rotation (T+5 to T+15 min)

#### 1. Generate Clean Emergency Oracle Key

Provision a new Ed25519 keypair in an isolated KMS environment:

```bash
stellar keys generate oracle-emergency --network <network> --fund
```

#### 2. Rotate Oracle on Escrow Contract

Execute `set_oracle` using the admin key:

```bash
stellar contract invoke \
  --id $ESCROW_CONTRACT_ID \
  --source admin \
  --network <network> \
  -- \
  set_oracle \
  --new_oracle $(stellar keys address oracle-emergency)
```

Verify that the old compromised key is no longer authorized.

---

### Phase 3: Forensic Audit & Impact Assessment (T+15 to T+60 min)

#### 1. Audit Malicious Confirmations

Query all `confirm_reply` events during the compromise window:

```sql
SELECT c.ledger, c.tx_hash, c.stake_id, m.sender_addr, m.recipient_id, r.id as evidence_id
FROM chain_events c
JOIN messages m ON m.stake_id = c.stake_id
LEFT JOIN reply_evidence r ON r.message_id = m.id AND r.oracle_tx = c.tx_hash
WHERE c.topic = 'replied'
  AND c.ledger >= <compromise_start_ledger>
ORDER BY c.ledger DESC;
```

Identify any stakes marked `Refunded` on-chain that **lack** a corresponding, verified `reply_evidence` row in the database.

#### 2. Calculate Financial Discrepancies

For any recipient whose stake was fraudulently refunded without a reply:

- Log recipient addresses and affected USDC amounts for reimbursement.

---

### Phase 4: Recovery & Service Restoration

1. Deploy the new Oracle service configuration pointing to the clean key.
2. Verify all valid backlog reply evidence is processed.
3. Unpause the contract:
   ```bash
   stellar contract invoke \
     --id $ESCROW_CONTRACT_ID \
     --source admin \
     --network <network> \
     -- \
     unpause
   ```

---

### Phase 5: Post-Mortem & Disclosure

1. Conduct root-cause analysis (compromised CI token, exposed env, host breach).
2. Publish an incident post-mortem in accordance with the security disclosure policy in `SECURITY.md`.
