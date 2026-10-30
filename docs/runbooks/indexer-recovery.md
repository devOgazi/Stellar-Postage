# Runbook: Recovering the Indexer After a Gap

## 1. Overview & Problem Statement

The Soroban Event Indexer (`services/indexer`) polls on-chain events via `getEvents` on the Soroban RPC server.

Public and standard Soroban RPC nodes retain event history for a bounded retention window (typically 10,000 to 100,000 ledgers, roughly 14 to 140 hours). If the indexer service is stopped, crashed, or partitioned for longer than this retention window, the RPC server will reject requests with:

```
RPC retention limit exceeded: requested start ledger X is older than retention window (Y ledgers behind latest Z). Gaps cannot be bridged automatically; manual backfill required.
```

When this occurs, the indexer halts immediately to avoid silently dropping events or corrupting ledger state.

---

## 2. Recovery Checklist

- Database connection string (`DATABASE_URL`).
- Access to Soroban RPC endpoint or an archival Horizon/RPC node.
- Postgres admin access to inspect and update `chain_cursors`, `chain_events`, and `messages`.

---

## 3. Step-by-Step Recovery Procedure

### Step 1: Diagnose the Lag and Determine the Gap Window

1. Query the stored cursor from the database:
   ```sql
   SELECT id, last_ledger, updated_at FROM chain_cursors WHERE id = 'soroban_escrow_events';
   ```
2. Query the current network ledger height from the RPC endpoint:
   ```bash
   curl -s -X POST $SOROBAN_RPC_URL \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq .result.sequence
   ```
3. Calculate the gap:
   $$\text{Gap} = \text{Latest Ledger} - \text{Stored Cursor}$$

### Step 2: Fetch Missed Contract Events from Horizon Archive

If the standard Soroban RPC retention window has expired, use Horizon's historical contract operations or an archival RPC provider to fetch events for the contract address between `Stored Cursor` and `Latest Ledger`.

For each missing event (`sent`, `replied`, `spam`, `claimed`, `price`):

1. Extract:
   - `ledger`
   - `tx_hash`
   - `event_idx`
   - `topic`
   - `stake_id`
   - `payload`
2. Insert into `chain_events` table idempotently:
   ```sql
   INSERT INTO chain_events (ledger, tx_hash, event_idx, topic, stake_id, payload)
   VALUES ($1, $2, $3, $4, $5, $6::jsonb)
   ON CONFLICT (ledger, tx_hash, event_idx) DO NOTHING;
   ```

### Step 3: Reconcile Message State Table

Verify that any stakes whose status changed during the gap are updated in the `messages` table:

- If a `replied` event was recorded:
  ```sql
  UPDATE messages SET status = 'replied' WHERE stake_id = <stake_id> AND status != 'replied';
  ```
- If a `claimed` event was recorded:
  ```sql
  UPDATE messages SET status = 'expired' WHERE stake_id = <stake_id> AND status != 'expired';
  ```
- If a `spam` event was recorded:
  ```sql
  UPDATE messages SET status = 'spam' WHERE stake_id = <stake_id> AND status != 'spam';
  ```

### Step 4: Advance the Durable Cursor

Once all events across the gap have been backfilled and verified, update the cursor to the latest safe ledger:

```sql
UPDATE chain_cursors
SET last_ledger = <safe_latest_ledger>, updated_at = now()
WHERE id = 'soroban_escrow_events';
```

### Step 5: Restart the Indexer Service

Restart the indexer service container:

```bash
docker compose restart indexer
```

Check the indexer logs to verify it resumes normal polling without errors:

```bash
docker compose logs -f indexer
```

Verify the health check endpoint returns `status: "ok"`:

```bash
curl http://localhost:8080/health
# Output: {"status":"ok","currentLedger":...,"latestLedger":...,"lag":0}
```
