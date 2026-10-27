import { Keypair, StrKey, WebAuth } from '@stellar/stellar-sdk';
import type { DataAccessLayer } from '../db/dal.js';
import type { UserRow } from '../db/types.js';
import type { NonceStore } from './nonce.js';
import { signJwt } from './jwt.js';

export interface ChallengeResponse {
  transaction: string;
  challenge: string;
  network_passphrase: string;
}

export interface AuthSessionResponse {
  user: UserRow;
  token: string;
}

export class AuthService {
  constructor(
    private sponsorKeypair: Keypair,
    private networkPassphrase: string,
    private domain: string,
    private authExpirySecs: number,
    private sessionSecret: string,
    private nonceStore: NonceStore,
    private dal: DataAccessLayer
  ) {}

  generateChallenge(clientAddress: string): ChallengeResponse {
    if (!StrKey.isValidEd25519PublicKey(clientAddress)) {
      throw new Error(`Invalid Stellar address: ${clientAddress}`);
    }

    const txXdr = WebAuth.buildChallengeTx(
      this.sponsorKeypair,
      clientAddress,
      this.domain,
      this.authExpirySecs,
      this.networkPassphrase,
      this.domain
    );

    const parsed = WebAuth.readChallengeTx(
      txXdr,
      this.sponsorKeypair.publicKey(),
      this.networkPassphrase,
      [this.domain],
      this.domain
    );

    const firstOp = parsed.tx.operations[0];
    const rawVal = firstOp && 'value' in firstOp ? firstOp.value : null;
    const nonce = Buffer.isBuffer(rawVal)
      ? rawVal.toString('base64')
      : typeof rawVal === 'string'
        ? rawVal
        : '';

    if (!nonce) {
      throw new Error('Failed to generate challenge nonce');
    }

    const expiresAt = Date.now() + this.authExpirySecs * 1000;
    this.nonceStore.set(nonce, expiresAt);

    return {
      transaction: txXdr,
      challenge: txXdr,
      network_passphrase: this.networkPassphrase,
    };
  }

  async verifyChallenge(signedXdr: string): Promise<AuthSessionResponse> {
    if (!signedXdr || typeof signedXdr !== 'string') {
      throw new Error('Missing challenge transaction XDR');
    }

    // 1. Parse and validate structure and server signature
    let parsed;
    try {
      parsed = WebAuth.readChallengeTx(
        signedXdr,
        this.sponsorKeypair.publicKey(),
        this.networkPassphrase,
        [this.domain],
        this.domain
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid challenge: ${msg}`);
    }

    // 2. Freshness and timebounds check
    const nowSecs = Math.floor(Date.now() / 1000);
    const maxTime = parseInt(parsed.tx.timeBounds?.maxTime ?? '0', 10);
    const minTime = parseInt(parsed.tx.timeBounds?.minTime ?? '0', 10);
    if (maxTime > 0 && (nowSecs > maxTime || nowSecs < minTime)) {
      throw new Error('Challenge transaction has expired');
    }

    // 3. Nonce verification and replay protection
    const firstOp = parsed.tx.operations[0];
    const rawVal = firstOp && 'value' in firstOp ? firstOp.value : null;
    const nonce = Buffer.isBuffer(rawVal)
      ? rawVal.toString('base64')
      : typeof rawVal === 'string'
        ? rawVal
        : '';

    if (!nonce || !this.nonceStore.consume(nonce)) {
      throw new Error('Challenge nonce is expired, invalid, or already replayed');
    }

    // 4. Verify client account signature
    const clientAddress = parsed.clientAccountID;
    try {
      const signers = WebAuth.verifyChallengeTxSigners(
        signedXdr,
        this.sponsorKeypair.publicKey(),
        this.networkPassphrase,
        [clientAddress],
        [this.domain],
        this.domain
      );
      if (!signers.includes(clientAddress)) {
        throw new Error('Transaction was not signed by the expected client address');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Signature verification failed: ${msg}`);
    }

    // 5. Upsert user in database
    const user = await this.dal.upsertUser(clientAddress);

    // 6. Issue session JWT
    const token = signJwt(
      {
        sub: user.id,
        stellar_address: user.stellar_address,
      },
      this.sessionSecret
    );

    return { user, token };
  }
}
