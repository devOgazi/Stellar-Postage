import { nativeToScVal, xdr } from '@stellar/stellar-sdk';

/**
 * Helper to encode an ScVal into base64 for Soroban RPC event simulation.
 */
function toBase64(scVal: xdr.ScVal): string {
  return scVal.toXDR('base64');
}

export const RECORDED_EVENTS_FIXTURES = [
  // 1. "sent" event for stake 100
  {
    id: '0000000000010001-0000000001',
    type: 'contract',
    ledger: 10001,
    ledgerClosedAt: '2026-10-29T12:00:00Z',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    topic: [
      toBase64(xdr.ScVal.scvSymbol('sent')),
      toBase64(nativeToScVal(100n, { type: 'u64' })),
    ],
    value: toBase64(
      nativeToScVal({
        id: 100n,
        sender: 'GBOB_SENDER_123',
        recipient: 'GALICE_RECIPIENT_123',
        token: 'CUSDC_TOKEN_ADDR',
        amount: 50_000_000n,
        msg_hash: Buffer.alloc(32, 0x11),
        created_at: 1700000000n,
        deadline: 1700086400n,
        status: { tag: 'Pending' },
      })
    ),
    txHash: 'tx_hash_sent_100',
  },

  // 2. "replied" event for stake 100
  {
    id: '0000000000010002-0000000001',
    type: 'contract',
    ledger: 10002,
    ledgerClosedAt: '2026-10-29T12:05:00Z',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    topic: [
      toBase64(xdr.ScVal.scvSymbol('replied')),
      toBase64(nativeToScVal(100n, { type: 'u64' })),
    ],
    value: toBase64(xdr.ScVal.scvVoid()),
    txHash: 'tx_hash_replied_100',
  },

  // 3. "spam" event for stake 101
  {
    id: '0000000000010003-0000000001',
    type: 'contract',
    ledger: 10003,
    ledgerClosedAt: '2026-10-29T12:10:00Z',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    topic: [
      toBase64(xdr.ScVal.scvSymbol('spam')),
      toBase64(nativeToScVal(101n, { type: 'u64' })),
    ],
    value: toBase64(xdr.ScVal.scvVoid()),
    txHash: 'tx_hash_spam_101',
  },

  // 4. "claimed" event for stake 102
  {
    id: '0000000000010004-0000000001',
    type: 'contract',
    ledger: 10004,
    ledgerClosedAt: '2026-10-29T12:15:00Z',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    topic: [
      toBase64(xdr.ScVal.scvSymbol('claimed')),
      toBase64(nativeToScVal(102n, { type: 'u64' })),
    ],
    value: toBase64(xdr.ScVal.scvVoid()),
    txHash: 'tx_hash_claimed_102',
  },

  // 5. "price" event for recipient Alice
  {
    id: '0000000000010005-0000000001',
    type: 'contract',
    ledger: 10005,
    ledgerClosedAt: '2026-10-29T12:20:00Z',
    contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    topic: [
      toBase64(xdr.ScVal.scvSymbol('price')),
      toBase64(xdr.ScVal.scvString('GALICE_RECIPIENT_123')),
    ],
    value: toBase64(
      nativeToScVal({
        min_amount: 50_000_000n,
        min_window_secs: 3600n,
        max_window_secs: 604800n,
      })
    ),
    txHash: 'tx_hash_price_alice',
  },
];
