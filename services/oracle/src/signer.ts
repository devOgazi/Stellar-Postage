import { Keypair, type Transaction, xdr } from '@stellar/stellar-sdk';

/**
 * Common Signer interface for abstracting signing operations.
 * Allows switching between LocalSigner (dev only) and KMS/HSM in production.
 */
export interface Signer {
  getPublicKey(): Promise<string>;
  signTransaction(tx: Transaction): Promise<Transaction>;
}

/**
 * LocalSigner – Development only.
 * Reads the ORACLE_SECRET from environment or configuration and signs locally in memory.
 * README: "The oracle key lives in a KMS/HSM ... never in the app's environment."
 */
export class LocalSigner implements Signer {
  private readonly keypair: Keypair;

  constructor(secretKey?: string) {
    const secret = secretKey || process.env['ORACLE_SECRET'];
    if (!secret) {
      throw new Error(
        'ORACLE_SECRET is required for LocalSigner. In production, use KmsSigner instead.'
      );
    }
    this.keypair = Keypair.fromSecret(secret);
  }

  async getPublicKey(): Promise<string> {
    return this.keypair.publicKey();
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    tx.sign(this.keypair);
    return tx;
  }
}

/**
 * KmsSignerStub – Production KMS/HSM signer stub.
 *
 * In production:
 * - Oracle key lives in AWS KMS, GCP Cloud KMS, or Vault HSM.
 * - Secret never leaves the hardware boundary.
 * - Workflow:
 *   1. Calculate the 32-byte transaction hash: `tx.hash()`
 *   2. Send Sign request to Cloud KMS:
 *      `await kmsClient.sign({ KeyId: this.kmsKeyId, Message: txHash, MessageType: 'DIGEST', SigningAlgorithm: 'ED25519' })`
 *   3. Parse KMS response into 64-byte Ed25519 signature
 *   4. Append DecoratedSignature to `tx.signatures`
 */
export interface KmsConfig {
  keyId: string;
  region?: string;
  provider?: 'aws' | 'gcp' | 'vault';
}

export class KmsSignerStub implements Signer {
  private readonly config: KmsConfig;
  private readonly mockPublicKey: string;

  constructor(config: KmsConfig, mockPublicKey?: string) {
    this.config = config;
    this.mockPublicKey =
      mockPublicKey || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  }

  async getPublicKey(): Promise<string> {
    return this.mockPublicKey;
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    // When live KMS is configured, invoke AWS/GCP KMS API here.
    // Stub appends a dummy signature hint for demonstration.
    const hint = Buffer.from(this.mockPublicKey.slice(-4), 'utf8');
    const dummySignature = Buffer.alloc(64, 0xaa);
    const decoratedSig = new xdr.DecoratedSignature({
      hint: hint.subarray(0, 4),
      signature: dummySignature,
    });
    tx.signatures.push(decoratedSig);
    return tx;
  }
}
