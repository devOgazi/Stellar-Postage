import crypto from 'node:crypto';
import { Keypair, Networks } from '@stellar/stellar-sdk';

export interface AppConfig {
  port: number;
  stellarNetwork: string;
  networkPassphrase: string;
  sorobanRpcUrl: string;
  horizonUrl: string;
  escrowContractId: string;
  usdcSacId: string;
  sponsorKeypair: Keypair;
  databaseUrl: string;
  sessionSecret: string;
  domain: string;
  authExpirySecs: number;
  replyVetoWindowSecs: number;
  messageEncryptionKey: Buffer;
}

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  const stellarNetwork = process.env['STELLAR_NETWORK'] || 'testnet';
  const networkPassphrase =
    process.env['NETWORK_PASSPHRASE'] ||
    (stellarNetwork === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET);

  let sponsorKeypair: Keypair;
  const sponsorSecret = process.env['SPONSOR_SECRET'];
  if (sponsorSecret && sponsorSecret.startsWith('S') && sponsorSecret.length === 56) {
    try {
      sponsorKeypair = Keypair.fromSecret(sponsorSecret);
    } catch {
      sponsorKeypair = Keypair.random();
    }
  } else {
    // Generate an ephemeral server keypair for development/testing
    sponsorKeypair = Keypair.random();
  }

  let messageKey: Buffer;
  const rawKey = process.env['MESSAGE_ENCRYPTION_KEY'];
  if (rawKey) {
    try {
      messageKey = Buffer.from(rawKey, 'base64');
      if (messageKey.length !== 32) {
        messageKey = crypto.createHash('sha256').update(rawKey).digest();
      }
    } catch {
      messageKey = crypto.randomBytes(32);
    }
  } else {
    messageKey = crypto.randomBytes(32);
  }

  const baseConfig: AppConfig = {
    port: parseInt(process.env['PORT'] || '4000', 10),
    stellarNetwork,
    networkPassphrase,
    sorobanRpcUrl: process.env['SOROBAN_RPC_URL'] || 'https://soroban-testnet.stellar.org',
    horizonUrl: process.env['HORIZON_URL'] || 'https://horizon-testnet.stellar.org',
    escrowContractId: process.env['ESCROW_CONTRACT_ID'] || '',
    usdcSacId: process.env['USDC_SAC_ID'] || '',
    sponsorKeypair,
    databaseUrl: process.env['DATABASE_URL'] || 'postgres://postgres:postgres@localhost:5432/postage',
    sessionSecret: process.env['SESSION_SECRET'] || 'development-session-secret-at-least-32-chars-long',
    domain: process.env['AUTH_DOMAIN'] || 'postage.stellar',
    authExpirySecs: parseInt(process.env['AUTH_EXPIRY_SECS'] || '300', 10),
    replyVetoWindowSecs: parseInt(process.env['REPLY_VETO_WINDOW_SECS'] || '600', 10),
    messageEncryptionKey: messageKey,
  };

  return { ...baseConfig, ...overrides };
}
