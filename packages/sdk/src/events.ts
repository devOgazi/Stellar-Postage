/**
 * packages/sdk/src/events.ts
 * Event decoders for sent, replied, spam, claimed, price events.
 */

import { scValToNative, xdr } from '@stellar/stellar-sdk';
import type { DecodedEvent, PriceConfig, Stake, StakeStatus } from './types.js';

function parseStatus(rawStatus: unknown): StakeStatus {
  if (typeof rawStatus === 'string') {
    if (rawStatus === 'Pending' || rawStatus === 'Refunded' || rawStatus === 'Claimed') {
      return rawStatus;
    }
  }
  if (typeof rawStatus === 'object' && rawStatus !== null && 'tag' in rawStatus) {
    const tag = (rawStatus as { tag: unknown }).tag;
    if (tag === 'Pending' || tag === 'Refunded' || tag === 'Claimed') {
      return tag;
    }
  }
  return 'Pending';
}

function parseStake(raw: Record<string, unknown>): Stake {
  const hashRaw = raw['msg_hash'];
  const hashHex =
    Buffer.isBuffer(hashRaw) || hashRaw instanceof Uint8Array
      ? Buffer.from(hashRaw).toString('hex')
      : String(hashRaw);

  return {
    id: BigInt(raw['id'] as string | number | bigint),
    sender: String(raw['sender']),
    recipient: String(raw['recipient']),
    token: String(raw['token']),
    amount: BigInt(raw['amount'] as string | number | bigint),
    msg_hash: hashHex,
    created_at: BigInt(raw['created_at'] as string | number | bigint),
    deadline: BigInt(raw['deadline'] as string | number | bigint),
    status: parseStatus(raw['status']),
  };
}

function parsePriceConfig(raw: Record<string, unknown>): PriceConfig {
  return {
    min_amount: BigInt(raw['min_amount'] as string | number | bigint),
    min_window_secs: BigInt(raw['min_window_secs'] as string | number | bigint),
    max_window_secs: BigInt(raw['max_window_secs'] as string | number | bigint),
  };
}

/**
 * Decode a raw Soroban event into a typed DecodedEvent.
 */
export function decodeEvent(raw: unknown): DecodedEvent | null {
  if (!raw) return null;

  let topics: unknown[] = [];
  let dataVal: unknown = null;

  const rawObj = raw as Record<string, unknown>;

  // 1. Check if raw is xdr.ContractEvent
  if (raw instanceof xdr.ContractEvent || (typeof (raw as { body?: unknown }).body === 'function')) {
    const event = raw as xdr.ContractEvent;
    const v0 = event.body().v0();
    topics = v0.topics().map((t: xdr.ScVal) => scValToNative(t) as unknown);
    dataVal = scValToNative(v0.data());
  }
  // 2. Check if raw is from Soroban RPC getEvents response
  else if (Array.isArray(rawObj['topic'])) {
    const rawTopics = rawObj['topic'] as unknown[];
    topics = rawTopics.map((t: unknown) => {
      if (typeof t === 'string') {
        try {
          const scVal = xdr.ScVal.fromXDR(t, 'base64');
          return scValToNative(scVal) as unknown;
        } catch {
          return t;
        }
      }
      if (t instanceof xdr.ScVal) {
        return scValToNative(t) as unknown;
      }
      return t;
    });

    const rawValue = rawObj['value'];
    if (rawValue) {
      if (typeof rawValue === 'string') {
        try {
          const scVal = xdr.ScVal.fromXDR(rawValue, 'base64');
          dataVal = scValToNative(scVal);
        } catch {
          dataVal = rawValue;
        }
      } else if (typeof rawValue === 'object' && rawValue !== null && 'xdr' in rawValue) {
        const scVal = xdr.ScVal.fromXDR((rawValue as { xdr: string }).xdr, 'base64');
        dataVal = scValToNative(scVal);
      } else if (rawValue instanceof xdr.ScVal) {
        dataVal = scValToNative(rawValue);
      } else {
        dataVal = rawValue;
      }
    }
  } else if (rawObj['topics'] && Array.isArray(rawObj['topics'])) {
    topics = rawObj['topics'] as unknown[];
    dataVal = rawObj['data'];
  }

  if (topics.length === 0) {
    return null;
  }

  const topicName = String(topics[0]);

  switch (topicName) {
    case 'sent': {
      const stakeId = BigInt(topics[1] as string | number | bigint);
      const stake = parseStake(dataVal as Record<string, unknown>);
      return { type: 'sent', stake_id: stakeId, stake };
    }
    case 'replied': {
      const stakeId = BigInt(topics[1] as string | number | bigint);
      return { type: 'replied', stake_id: stakeId };
    }
    case 'spam': {
      const stakeId = BigInt(topics[1] as string | number | bigint);
      return { type: 'spam', stake_id: stakeId };
    }
    case 'claimed': {
      const stakeId = BigInt(topics[1] as string | number | bigint);
      return { type: 'claimed', stake_id: stakeId };
    }
    case 'price': {
      const recipient = String(topics[1]);
      const config = parsePriceConfig(dataVal as Record<string, unknown>);
      return { type: 'price', recipient, config };
    }
    default:
      return null;
  }
}
