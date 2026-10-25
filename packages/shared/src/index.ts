/**
 * @stellar-postage/shared
 * Types, validation, and constants shared across all packages and services.
 * Names must match the README Smart Contract Specification exactly.
 */

// ---------------------------------------------------------------------------
// On-chain stake status (mirrors the Rust Status enum)
// ---------------------------------------------------------------------------
export type StakeStatus = 'Pending' | 'Refunded' | 'Claimed';

// ---------------------------------------------------------------------------
// Stake (mirrors the Rust Stake struct)
// ---------------------------------------------------------------------------
export interface Stake {
  id: bigint;
  sender: string; // Stellar address
  recipient: string; // Stellar address
  token: string; // USDC SAC contract id
  amount: bigint; // token base units (USDC has 7 decimals on Stellar)
  msg_hash: string; // hex-encoded SHA-256
  created_at: bigint; // ledger timestamp (unix seconds)
  deadline: bigint; // reply must be confirmed by this time
  status: StakeStatus;
}

// ---------------------------------------------------------------------------
// PriceConfig (mirrors the Rust PriceConfig struct)
// ---------------------------------------------------------------------------
export interface PriceConfig {
  min_amount: bigint; // minimum stake in token base units
  min_window_secs: bigint;
  max_window_secs: bigint;
}

// ---------------------------------------------------------------------------
// Database message status (matches messages.status column)
// ---------------------------------------------------------------------------
export type MessageStatus =
  | 'pending'
  | 'delivered'
  | 'replied'
  | 'spam'
  | 'expired';

// ---------------------------------------------------------------------------
// Channel kinds (matches channels.kind check constraint)
// ---------------------------------------------------------------------------
export type ChannelKind = 'telegram' | 'email';

// ---------------------------------------------------------------------------
// Contract event names (must match on-chain symbol_short! strings)
// ---------------------------------------------------------------------------
export const CONTRACT_EVENTS = {
  SENT: 'sent',
  REPLIED: 'replied',
  SPAM: 'spam',
  CLAIMED: 'claimed',
  PRICE: 'price',
} as const;

export type ContractEventName =
  (typeof CONTRACT_EVENTS)[keyof typeof CONTRACT_EVENTS];

// ---------------------------------------------------------------------------
// Fee constants (mirror the Rust hard cap)
// ---------------------------------------------------------------------------
/** Hard cap on fee_bps in the escrow contract: 500 = 5% */
export const MAX_FEE_BPS = 500;
/** Basis point divisor */
export const BPS_DENOMINATOR = 10_000;

// ---------------------------------------------------------------------------
// Default policy values (match .env.example)
// ---------------------------------------------------------------------------
export const DEFAULT_REPLY_VETO_WINDOW_SECS = 600; // 10 minutes
export const DEFAULT_MIN_REPLY_WORDS = 1;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Returns fee and net-to-sender given an amount and fee_bps.
 *  Fee is rounded DOWN, favouring the sender (README: "fee rounding in favor of the sender").
 */
export function splitFee(
  amount: bigint,
  feeBps: bigint,
): { toSender: bigint; fee: bigint } {
  if (feeBps > BigInt(MAX_FEE_BPS)) {
    throw new Error(`fee_bps ${feeBps} exceeds hard cap ${MAX_FEE_BPS}`);
  }
  const fee = (amount * feeBps) / BigInt(BPS_DENOMINATOR); // integer division = floor
  return { toSender: amount - fee, fee };
}

/** Validates a PriceConfig shape. */
export function validatePriceConfig(cfg: PriceConfig): void {
  if (cfg.min_amount <= 0n) {
    throw new Error('min_amount must be > 0');
  }
  if (cfg.min_window_secs > cfg.max_window_secs) {
    throw new Error('min_window_secs must be <= max_window_secs');
  }
}
