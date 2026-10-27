import { Account, Keypair, Transaction, xdr } from '@stellar/stellar-sdk';
import { EscrowClient } from '../client.js';
import { EscrowContractError } from '../errors.js';

function createMockFn(defaultImpl?: (...args: any[]) => any) {
  let impl = defaultImpl;
  const queue: Array<(...args: any[]) => any> = [];
  const calls: any[][] = [];

  const fn: any = (...args: any[]) => {
    calls.push(args);
    if (queue.length > 0) {
      const next = queue.shift()!;
      return next(...args);
    }
    if (impl) return impl(...args);
  };

  fn.calls = calls;
  fn.mockImplementation = (newImpl: (...args: any[]) => any) => {
    impl = newImpl;
    return fn;
  };
  fn.mockResolvedValueOnce = (val: any) => {
    queue.push(() => Promise.resolve(val));
    return fn;
  };
  fn.mockResolvedValue = (val: any) => {
    impl = () => Promise.resolve(val);
    return fn;
  };

  return fn;
}

describe('EscrowClient unit tests with mocked RPC', () => {
  const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const token = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const callerKeypair = Keypair.random();
  const caller = callerKeypair.publicKey();
  const recipient = Keypair.random().publicKey();

  let mockServer: any;
  let client: EscrowClient;

  beforeEach(() => {
    mockServer = {
      getAccount: createMockFn((accId: string) => {
        return Promise.resolve(new Account(accId, '100'));
      }),
      simulateTransaction: createMockFn((_tx: Transaction) => {
        return Promise.resolve({
          minResourceFee: '100',
          transactionData: new xdr.SorobanTransactionData({
            ext: new (xdr.ExtensionPoint as any)(0),
            resources: new xdr.SorobanResources({
              footprint: new xdr.LedgerFootprint({
                readOnly: [],
                readWrite: [],
              }),
              instructions: 1000,
              readBytes: 100,
              writeBytes: 100,
            }),
            resourceFee: new xdr.Int64(100n),
          }).toXDR('base64'),
          results: [
            {
              auth: [],
              xdr: xdr.ScVal.scvVoid().toXDR('base64'),
            },
          ],
        });
      }),
      sendTransaction: createMockFn(),
      getTransaction: createMockFn(),
    };

    client = new EscrowClient({
      contractId,
      server: mockServer,
      defaultCaller: caller,
    });
  });

  it('builds setPrice transaction', async () => {
    const tx = await client.setPrice({
      recipient,
      minAmount: 50_000_000n,
      minWindow: 3600n,
      maxWindow: 604800n,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(mockServer.getAccount.calls.length).toBeGreaterThan(0);
    expect(mockServer.simulateTransaction.calls.length).toBeGreaterThan(0);
  });

  it('builds send transaction', async () => {
    const tx = await client.send({
      sender: caller,
      recipient,
      token,
      amount: 50_000_000n,
      msgHash: 'ab'.repeat(32),
      windowSecs: 86400n,
    });

    expect(tx).toBeInstanceOf(Transaction);
    expect(mockServer.getAccount.calls.length).toBeGreaterThan(0);
    expect(mockServer.simulateTransaction.calls.length).toBeGreaterThan(0);
  });

  it('builds confirmReply transaction', async () => {
    const tx = await client.confirmReply(42n);
    expect(tx).toBeInstanceOf(Transaction);
    expect(mockServer.simulateTransaction.calls.length).toBeGreaterThan(0);
  });

  it('builds flagSpam transaction', async () => {
    const tx = await client.flagSpam(42n);
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('builds claim transaction', async () => {
    const tx = await client.claim(42n);
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('builds getStake transaction', async () => {
    const tx = await client.getStake(42n);
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('builds getPrice transaction', async () => {
    const tx = await client.getPrice(recipient);
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('builds extendTtl transaction', async () => {
    const tx = await client.extendTtl(42n);
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('builds admin setOracle transaction', async () => {
    const newOracle = Keypair.random().publicKey();
    const tx = await client.setOracle(newOracle);
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('builds admin setFee transaction', async () => {
    const tx = await client.setFee(150);
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('builds admin pause transaction', async () => {
    const tx = await client.pause();
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('builds admin unpause transaction', async () => {
    const tx = await client.unpause();
    expect(tx).toBeInstanceOf(Transaction);
  });

  it('throws mapped EscrowContractError on simulation failure', async () => {
    mockServer.simulateTransaction.mockResolvedValueOnce({
      error: 'Host error: Error(Contract, #4)',
    });

    await expect(
      client.send({
        sender: caller,
        recipient,
        token,
        amount: 100n,
        msgHash: '00'.repeat(32),
        windowSecs: 86400n,
      })
    ).rejects.toThrow(EscrowContractError);

    mockServer.simulateTransaction.mockResolvedValueOnce({
      error: 'Host error: Error(Contract, #4)',
    });

    try {
      await client.send({
        sender: caller,
        recipient,
        token,
        amount: 100n,
        msgHash: '00'.repeat(32),
        windowSecs: 86400n,
      });
    } catch (e: any) {
      expect(e).toBeInstanceOf(EscrowContractError);
      expect(e.code).toBe(4);
      expect(e.errorName).toBe('BelowMinimum');
    }
  });

  it('submitAndWait polls until success', async () => {
    mockServer.sendTransaction.mockResolvedValueOnce({
      status: 'PENDING',
      hash: 'abc123hash',
    });

    mockServer.getTransaction
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'SUCCESS', hash: 'abc123hash' });

    const tx = await client.pause();
    const res = await client.submitAndWait(tx, { timeoutSecs: 5, pollIntervalMs: 10 });
    expect(res.status).toBe('SUCCESS');
    expect(mockServer.getTransaction.calls.length).toBe(2);
  });

  it('submitAndWait maps contract error on failed transaction', async () => {
    mockServer.sendTransaction.mockResolvedValueOnce({
      status: 'PENDING',
      hash: 'fail123',
    });

    mockServer.getTransaction.mockResolvedValueOnce({
      status: 'FAILED',
      hash: 'fail123',
      resultXdr: 'Error(Contract, #7)',
    });

    const tx = await client.pause();
    await expect(
      client.submitAndWait(tx, { timeoutSecs: 5, pollIntervalMs: 10 })
    ).rejects.toThrow(EscrowContractError);

    mockServer.sendTransaction.mockResolvedValueOnce({
      status: 'PENDING',
      hash: 'fail123',
    });
    mockServer.getTransaction.mockResolvedValueOnce({
      status: 'FAILED',
      hash: 'fail123',
      resultXdr: 'Error(Contract, #7)',
    });

    try {
      await client.submitAndWait(tx, { timeoutSecs: 5, pollIntervalMs: 10 });
    } catch (err: any) {
      expect(err).toBeInstanceOf(EscrowContractError);
      expect(err.code).toBe(7);
      expect(err.errorName).toBe('NotPending');
    }
  });
});

