import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { decodeEvent } from '../events.js';

describe('Event Decoding', () => {
  it('decodes sent event', () => {
    const raw = {
      topics: ['sent', '42'],
      data: {
        id: 42n,
        sender: 'GBOB',
        recipient: 'GALICE',
        token: 'CUSDC',
        amount: 50000000n,
        msg_hash: '00'.repeat(32),
        created_at: 1000n,
        deadline: 87400n,
        status: 'Pending',
      },
    };

    const decoded = decodeEvent(raw);
    expect(decoded).toEqual({
      type: 'sent',
      stake_id: 42n,
      stake: {
        id: 42n,
        sender: 'GBOB',
        recipient: 'GALICE',
        token: 'CUSDC',
        amount: 50000000n,
        msg_hash: '00'.repeat(32),
        created_at: 1000n,
        deadline: 87400n,
        status: 'Pending',
      },
    });
  });

  it('decodes replied event', () => {
    const raw = {
      topics: ['replied', '42'],
      data: null,
    };
    const decoded = decodeEvent(raw);
    expect(decoded).toEqual({
      type: 'replied',
      stake_id: 42n,
    });
  });

  it('decodes spam event', () => {
    const raw = {
      topics: ['spam', '99'],
      data: null,
    };
    const decoded = decodeEvent(raw);
    expect(decoded).toEqual({
      type: 'spam',
      stake_id: 99n,
    });
  });

  it('decodes claimed event', () => {
    const raw = {
      topics: ['claimed', '7'],
      data: null,
    };
    const decoded = decodeEvent(raw);
    expect(decoded).toEqual({
      type: 'claimed',
      stake_id: 7n,
    });
  });

  it('decodes price event', () => {
    const raw = {
      topics: ['price', 'GALICE'],
      data: {
        min_amount: 10000000n,
        min_window_secs: 3600n,
        max_window_secs: 604800n,
      },
    };
    const decoded = decodeEvent(raw);
    expect(decoded).toEqual({
      type: 'price',
      recipient: 'GALICE',
      config: {
        min_amount: 10000000n,
        min_window_secs: 3600n,
        max_window_secs: 604800n,
      },
    });
  });

  it('decodes xdr.ContractEvent object', () => {
    const topic0 = nativeToScVal('replied', { type: 'symbol' });
    const topic1 = nativeToScVal(15n, { type: 'u64' });
    const data = nativeToScVal(null, { type: 'void' });

    const v0 = new xdr.ContractEventV0({
      topics: [topic0, topic1],
      data,
    });
    const body = new (xdr.ContractEventBody as any)(0, v0);
    const ext = new (xdr.ExtensionPoint as any)(0);

    const contractEvent = new xdr.ContractEvent({
      ext,
      contractId: null,
      type: xdr.ContractEventType.contract(),
      body,
    });

    const decoded = decodeEvent(contractEvent);
    expect(decoded).toEqual({
      type: 'replied',
      stake_id: 15n,
    });
  });

  it('returns null for unknown event topics', () => {
    expect(decodeEvent({ topics: ['unknown_event'] })).toBeNull();
    expect(decodeEvent(null)).toBeNull();
  });
});
