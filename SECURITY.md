# Security Policy

The security of the **Stellar Postage** protocol and user funds in the Soroban escrow contract is our highest priority. We appreciate the responsible disclosure of security vulnerabilities by security researchers and community contributors.

---

## 1. Supported Versions

| Version            | Supported          | Notes                          |
| ------------------ | ------------------ | ------------------------------ |
| `main` (branch)    | :white_check_mark: | Active development / pre-alpha |
| Releases `< 0.1.0` | :x:                | Experimental testnet builds    |

---

## 2. Reporting a Vulnerability

**DO NOT** file public GitHub issues, discussions, or pull requests for suspected security vulnerabilities.

If you discover a security vulnerability, please submit a private disclosure report to:

📧 **`devogazi@gmail.com`**

### What to Include in Your Report

To help us triage and resolve the issue quickly, please provide:

1. **Description**: A clear summary of the vulnerability and its potential impact.
2. **Component**: Affected contract (`contracts/escrow`), backend API (`apps/api`), oracle (`services/oracle`), mailer (`services/mailer`), bot (`services/bot`), indexer (`services/indexer`), or sweeper (`services/sweeper`).
3. **Proof of Concept (PoC)**: Minimal steps, script, or unit test reproducing the exploit.
4. **Impact Assessment**: Assessment of whether user funds, message privacy, or contract availability are affected.
5. **Proposed Remediation**: Any recommended patch or mitigation, if known.

---

## 3. Response Process & Timeline

When you report a security vulnerability:

- **Initial Acknowledgment**: You will receive an acknowledgment within **48 hours**.
- **Assessment & Triage**: We will confirm the vulnerability, assign a severity rating, and keep you updated on progress.
- **Fix & Deployment**: We will develop and test a fix in a private repository.
- **Public Disclosure**: Once the fix is deployed to testnet/mainnet, we will coordinate public disclosure and credit the reporter.

---

## 4. Safe Harbor

If you conduct security research in good faith:

- We will not pursue legal action against you.
- We request that you avoid privacy violations, data destruction, service degradation, or interacting with live third-party accounts or funds.
- Please test exclusively against local mock environments or self-funded testnet instances.
