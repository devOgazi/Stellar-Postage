/**
 * packages/sdk/src/types.ts
 * Types matching the README Smart Contract Specification exactly.
 */

export type StakeStatus = 'Pending' | 'Refunded' | 'Claimed';

export interface Stake {
  id: bigint;
  sender: string;
  recipient: string;
  token: string;
  amount: bigint;
  msg_hash: string;
  created_at: bigint;
  deadline: bigint;
  status: StakeStatus;
}

export interface PriceConfig {
  min_amount: bigint;
  min_window_secs: bigint;
  max_window_secs: bigint;
}

export type DecodedEvent =
  | { type: 'sent'; stake_id: bigint; stake: Stake }
  | { type: 'replied'; stake_id: bigint }
  | { type: 'spam'; stake_id: bigint }
  | { type: 'claimed'; stake_id: bigint }
  | { type: 'price'; recipient: string; config: PriceConfig };

export interface SetPriceParams {
  recipient: string;
  minAmount: bigint;
  minWindow: bigint;
  maxWindow: bigint;
}

export interface SendParams {
  sender: string;
  recipient: string;
  token: string;
  amount: bigint;
  msgHash: string | Buffer | Uint8Array;
  windowSecs: bigint;
}
