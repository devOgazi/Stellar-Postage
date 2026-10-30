# Oracle Service Specification

This document details the operational mechanics, key custody architecture, evidence verification pipeline, and security boundaries of the **Stellar Postage Oracle Service**, expanding upon `README.md` §7.

---

## 1. Role and Core Mandate

In the Stellar Postage protocol, the smart contract resides on the Soroban virtual machine and has no direct network access to off-chain communication protocols (Telegram MTProto, SMTP/IMAP email).

Because recipients financially benefit from _not_ replying (retaining the full USDC stake upon expiry or marking spam), **recipients can never attest to their own replies**. Attestation must be issued by a neutral verifier controlling delivery telemetry: the **Oracle Service**.

The Oracle has a strictly bounded on-chain authority:

- It can **only** call `confirm_reply(stake_id)` on the deployed escrow contract.
- It **cannot** transfer funds arbitrarily.
- It **cannot** modify contract parameters, fees, or oracle addresses.
- It **cannot** prevent permissionless `claim()` once `deadline + grace_secs` has elapsed.

---

## 2. Oracle Evolution Roadmap

### v1: Single Trusted Key (Current MVP)

- **Key Custody**: The oracle Ed25519 signing key is managed inside a Hardware Security Module (HSM) or Cloud KMS (AWS KMS `ECC_ED25519`, GCP Cloud KMS, or HashiCorp Vault).
- **Environment Isolation**: In production, private key material never exists in application memory, environment variables, or disk volumes. In local/testnet development, `LocalSigner` provides an isolated software keypair wrapper.
- **Minimal Funding**: The oracle account maintains only the minimum reserve required for base fees and operations (~2 to 5 XLM). Network fee bumps are sponsored by a dedicated fee-bump sponsor account.
- **Evidence Trail**: Every signed transaction is paired with a verifiable `ReplyEvidence` record containing the cryptographic digest of the interaction.

### v2: Threshold Oracle (Roadmap)

- Multiple independent verifier nodes (operator, independent validator, community signer) participate in a threshold signature scheme (e.g., 2-of-3 multisig).
- Implemented natively via Stellar multisig accounts or a custom Soroban smart contract account that implements the `__check_auth` interface.
- Prevents a single operator point of failure or unilateral censorship.

### v3: Cryptographic Proofs (Roadmap)

- For the email flow, trust in the oracle operator is removed using **DKIM signatures and zero-knowledge proofs (zk-email)**.
- The user's mail server cryptographically signs the email header and body. A Soroban zk-verifier contract validates the RSA/Ed25519 DKIM signature and header references directly on-chain.

---

## 3. Evidence Pipeline and Validity Rules

Before the Oracle issues `confirm_reply(stake_id)`, incoming interactions must satisfy the **Reply Validity Rules**:

| Rule                      | Enforcement                                                                                                                         | Rationale                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Identity Verification** | Telegram: `from.id` matches verified channel.<br>Email: `From` matches registered recipient and DKIM/SPF/DMARC = `pass`.            | Prevents third parties or impostors from triggering fraudulent refunds.                               |
| **Threading Integrity**   | Telegram: `reply_to_message.message_id` matches delivered ID.<br>Email: `In-Reply-To` / `References` matches outbound `Message-ID`. | Guarantees reply is directly connected to the specific staked message.                                |
| **Minimum Content**       | Word count $\ge 1$ (excluding whitespace and emojis).                                                                               | Rejects reaction-only or empty messages.                                                              |
| **Auto-Reply Filter**     | Rejects messages with `Auto-Submitted` (anything other than `no`), `X-Autoreply`, or out-of-office heuristics.                      | Protects senders from losing their attention stake to vacation responders or automated vacation bots. |
| **Recipient Veto Window** | 10-minute hold period before submission.                                                                                            | Gives the recipient time to flag spam or click **"Not a real reply"** before funds leave escrow.      |
| **Replay Prevention**     | Stake status must be strictly `Pending`. Once transitioned to `Refunded`, all further attempts abort.                               | Eliminates duplicate settlement and double refund attacks.                                            |

---

## 4. Attestation Log & Evidence Schema

Every verified reply creates an immutable row in the `reply_evidence` table before the transaction is submitted:

```sql
CREATE TABLE reply_evidence (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID REFERENCES messages(id),
  kind        TEXT NOT NULL,        -- 'telegram' | 'email'
  payload     JSONB NOT NULL,       -- Normalized channel metadata
  hash        BYTEA NOT NULL,       -- SHA-256 hash of payload
  oracle_tx   TEXT,                 -- Stellar transaction hash
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Payload Structure Examples

#### Telegram Evidence Payload:

```json
{
  "message_id": 101,
  "chat_id": 123456789,
  "from_id": 123456789,
  "reply_to_message_id": 42,
  "text": "Thanks for reaching out, happy to review your deck.",
  "date": 1698667200
}
```

#### Email Evidence Payload:

```json
{
  "message_id": "<s_8f3a9c@reply.example.com>",
  "from": "alice@company.com",
  "in_reply_to": "<msg_01HGB...>",
  "subject": "Re: Partnership Inquiry",
  "dkim_status": "pass",
  "spf_status": "pass",
  "dmarc_status": "pass",
  "body_length": 84
}
```

---

## 5. Channel Account Pooling & Nonce Management

Stellar uses monotonic sequence numbers per account. If multiple transactions are submitted in parallel using the same source account, out-of-order execution produces `txBAD_SEQ` errors.

To achieve high throughput:

1. The Oracle maintains a **Channel Account Pool** (an array of pre-funded Stellar accounts).
2. For each transaction submission:
   - A channel account is leased from the pool.
   - The transaction sequence number is read specifically for that channel.
   - The contract invocation is wrapped: the channel account acts as the transaction fee source and sequence counter, while the Oracle KMS key provides the Soroban contract authorization signature.
   - Upon completion or failure, the channel account is returned to the pool.
3. If `txBAD_SEQ` or resource exhaustion occurs, the submitter backs off exponentially with jitter and retries up to `maxRetries` (default: 3).

---

## 6. Security Boundaries & Threat Mitigations

- **Dishonest Oracle Withholding Refunds**: Because `ReplyEvidence` payloads are recorded with timestamps, any discrepancy between an off-chain verified reply and an unconfirmed stake is provable.
- **Grace Period Protection**: The contract requires that `confirm_reply` be executed before `deadline + grace_secs`. If an oracle suffers transient downtime, the 1-hour grace window prevents premature sweeper claims while recovery takes place.
- **Key Compromise Response**: The contract `admin` can immediately invoke `set_oracle(new_oracle)` to rotate the active key without impacting existing funds or requiring contract redeployment.
