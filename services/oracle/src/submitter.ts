import type { EscrowClient } from '@stellar-postage/sdk';
import type { Signer } from './signer.js';
import type { ChannelAccountPool } from './channelPool.js';

export interface SubmitterConfig {
  maxRetries?: number | undefined;
  initialBackoffMs?: number | undefined;
  backoffFactor?: number | undefined;
}

export function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /txBAD_SEQ|bad_seq|BAD_SEQ/i.test(msg) ||
    /resource[-_ ]limit|limit[-_ ]exceeded/i.test(msg) ||
    /txINTERNAL_ERROR|internal_error/i.test(msg) ||
    /timeout|timed out/i.test(msg) ||
    /rate[-_ ]limit|429/i.test(msg)
  );
}

export class TransactionSubmitter {
  private readonly escrowClient: EscrowClient;
  private readonly signer: Signer;
  private readonly channelPool: ChannelAccountPool;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly backoffFactor: number;

  constructor(
    escrowClient: EscrowClient,
    signer: Signer,
    channelPool: ChannelAccountPool,
    config?: SubmitterConfig
  ) {
    this.escrowClient = escrowClient;
    this.signer = signer;
    this.channelPool = channelPool;
    this.maxRetries = config?.maxRetries ?? 3;
    this.initialBackoffMs = config?.initialBackoffMs ?? 300;
    this.backoffFactor = config?.backoffFactor ?? 2;
  }

  /**
   * Builds, signs, and submits confirm_reply(stake_id) with channel account pooling,
   * handling txBAD_SEQ and resource limits with bounded retries and exponential backoff.
   */
  async submitConfirmReply(
    stakeId: bigint | number,
    retryDelayFn?: (ms: number) => Promise<void>
  ): Promise<{ txHash: string; ledger?: number }> {
    const sleep = retryDelayFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.channelPool.withChannel(async (channelAccount) => {
          // 1. Build confirm_reply transaction with channelAccount as caller/fee source
          const unsignedTx = await this.escrowClient.confirmReply(stakeId, channelAccount);

          // 2. Sign transaction with Oracle Signer
          const signedTx = await this.signer.signTransaction(unsignedTx);

          // 3. Submit and wait for confirmation
          const result = await this.escrowClient.submitAndWait(signedTx);
          return {
            txHash: (result as any).hash || signedTx.hash().toString('hex'),
            ledger: (result as any).latestLedger,
          };
        });
      } catch (err: unknown) {
        lastError = err;

        if (attempt < this.maxRetries && isRetryableError(err)) {
          const backoff = this.initialBackoffMs * Math.pow(this.backoffFactor, attempt);
          await sleep(backoff);
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }
}
