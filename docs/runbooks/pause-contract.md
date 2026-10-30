# Runbook: Emergency Contract Pause & Unpause

## 1. Overview & Protocol Invariant

The Stellar Postage Soroban escrow contract features an administrative emergency circuit breaker:

- `pause()`: Suspends new stake creation (`send()`).
- `unpause()`: Restores normal staking operations.

### Critical Protocol Invariant

> **Pausing never blocks settlement of existing stakes.**
>
> - `confirm_reply(stake_id)` continues to function normally.
> - `claim(stake_id)` continues to function normally.
> - `flag_spam(stake_id)` continues to function normally.
> - Funds currently locked in escrow are NEVER trapped or frozen by a pause.

---

## 2. When to Trigger a Pause

Execute `pause()` under the following emergency conditions:

- A severe bug or vulnerability is identified in off-chain message delivery or reply detection.
- The Oracle signing key is suspected to be compromised (see [Oracle Compromise Incident](./oracle-compromise-incident.md)).
- An upstream dependency (e.g., Postmark email webhook or Telegram Bot API) is compromised or spoofing interactions.
- A critical economic exploit or pricing arithmetic vulnerability is discovered.

---

## 3. Step-by-Step Procedure

### Step 1: Execute `pause()`

Using the `stellar` CLI with the admin key:

```bash
stellar contract invoke \
  --id $ESCROW_CONTRACT_ID \
  --source admin \
  --network <network> \
  -- \
  pause
```

### Step 2: Verify the Paused State

1. **Verify New `send()` Calls Fail**:
   Attempting to call `send` should revert immediately with `Error::Paused` (`error code 3`):
   ```bash
   # Test send invocation fails with Error(Contract, #3)
   stellar contract invoke \
     --id $ESCROW_CONTRACT_ID \
     --source bob \
     --network <network> \
     -- \
     send ...
   ```
2. **Verify Settlement Still Works**:
   Confirm that existing pending stakes can still settle:
   - Oracle can invoke `confirm_reply()`.
   - Recipient can invoke `flag_spam()`.
   - Sweeper can invoke `claim()` for expired stakes.

### Step 3: Investigate & Remediate Root Cause

While new incoming traffic is halted:

1. Deploy hotfixes to backend microservices (`apps/api`, `services/mailer`, `services/bot`, `services/oracle`).
2. If necessary, rotate the Oracle key using [Rotating the Oracle Key](./rotate-oracle-key.md).
3. Verify database integrity and reconciliation between `chain_events` and `messages`.

### Step 4: Execute `unpause()`

Once the root cause is resolved and verified in staging:

```bash
stellar contract invoke \
  --id $ESCROW_CONTRACT_ID \
  --source admin \
  --network <network> \
  -- \
  unpause
```

### Step 5: Post-Unpause Verification

1. Test a live end-to-end send transaction from the compose UI or CLI.
2. Confirm the transaction succeeds and emits the `sent` event.
3. Verify that the event indexer ingests the new stake and updates the database.
