# Runbook: Handling Stuck Transactions & Nonce Desync

## 1. Overview & Triggers

During periods of high Stellar network traffic, fee spikes, or service restarts, transactions submitted by the **Oracle Service** or **Sweeper Service** may experience delays, timeouts, or failures.

**Typical Symptoms**:

- `txBAD_SEQ`: The transaction sequence number does not match the account's next sequence on the ledger.
- `txINSUFFICIENT_FEE`: Surging network congestion requires higher base fees than currently offered.
- `PENDING` timeout: Transaction remains pending in the node mempool without inclusion in a closed ledger.

---

## 2. Architecture & Channel Pool Fundamentals

To submit concurrent transactions without contention, Stellar Postage services use a **Channel Account Pool**:

- The main service account signs the contract authorization.
- Distinct channel accounts act as the transaction source and fee payer.
- If one channel account encounters a stuck transaction or sequence mismatch, it should not halt submissions across other channels.

---

## 3. Diagnosis Procedure

### Step 1: Identify the Failing Account and Transaction Hash

Inspect service error logs for the specific error:

```bash
docker compose logs oracle | grep -E "txBAD_SEQ|txINSUFFICIENT_FEE|submitAndWait"
```

Note:

- Transaction hash
- Source/Channel account public key (e.g., `GCHANNEL...`)

### Step 2: Query the On-Chain Account State

Inspect the channel account's true sequence number on the network:

```bash
curl -s "https://horizon-testnet.stellar.org/accounts/GCHANNEL..." | jq .sequence
```

Compare this with the sequence recorded in local service memory or the failed transaction envelope.

---

## 4. Resolution Steps

### Scenario A: Sequence Mismatch (`txBAD_SEQ`)

When a channel account's sequence gets out of sync (e.g., after an ungraceful shutdown or unhandled RPC timeout):

1. **Force Account Refresh**: The service submitter automatically reloads the account using `server.getAccount(channelPublicKey)` upon retry.
2. **Manual Sequence Reset via No-Op**:
   If a channel account has a pending transaction that was dropped by the network mempool:
   ```bash
   # Submit a 1-stroop self-payment or manage_data op to increment sequence deterministically
   stellar tx new payment --source GCHANNEL... --destination GCHANNEL... --amount 0.0000001 --network <network>
   ```
3. Return the refreshed channel to the active pool.

### Scenario B: Stuck Mempool Transaction & Fee-Bumping

If a transaction was broadcast but is stuck due to low network fees:

1. **Fee-Bump Transaction**:
   Stellar natively supports Fee-Bump Transactions (CAP-0015). The platform fee sponsor wraps the stuck transaction envelope with an elevated fee:

   ```javascript
   import { FeeBumpTransaction, TransactionBuilder } from '@stellar/stellar-sdk';

   const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
     sponsorKeypair,
     stuckInnerTx,
     '500000', // elevated max fee in stroops
     networkPassphrase,
   );
   feeBumpTx.sign(sponsorKeypair);
   await server.sendTransaction(feeBumpTx);
   ```

2. The network replaces the pending inner transaction with the higher-fee envelope, accelerating inclusion.

### Scenario C: Channel Account Temporary Eviction

If a specific channel account is locked in an indeterminate state:

1. Temporarily evict the channel key from the service channel pool.
2. Allow pending transactions 60 seconds to clear or timeout.
3. Verify on Horizon that `sequence` has incremented, then reintroduce the account to the pool.

---

## 5. Verification

Verify that unconfirmed reply evidence is resubmitted:

```sql
SELECT id, message_id, kind, oracle_tx, created_at
FROM reply_evidence
WHERE oracle_tx IS NULL;
```

Once settled, verify that the transaction hash is updated in `reply_evidence.oracle_tx` and on-chain stake status is `Refunded`.
