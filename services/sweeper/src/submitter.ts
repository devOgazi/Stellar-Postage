import { Keypair } from '@stellar/stellar-sdk';
import type { EscrowClient } from '@stellar-postage/sdk';
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

export class SweeperSubmitter {
  private readonly escrowClient: EscrowClient;
  private readonly sweeperKeypair?: Keypair | undefined;
  private readonly channelPool: ChannelAccountPool;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly backoffFactor: number;

  constructor(
    escrowClient: EscrowClient,
    channelPool: ChannelAccountPool,
    sweeperKeypair?: Keypair | undefined,
    config?: SubmitterConfig | undefined
  ) {
    this.escrowClient = escrowClient;
    this.channelPool = channelPool;
    this.sweeperKeypair = sweeperKeypair;
    this.maxRetries = config?.maxRetries ?? 3;
    this.initialBackoffMs = config?.initialBackoffMs ?? 300;
    this.backoffFactor = config?.backoffFactor ?? 2;
  }

  async submitClaim(
    stakeId: bigint | number,
    retryDelayFn?: ((ms: number) => Promise<void>) | undefined
  ): Promise<{ txHash: string }> {
    const sleep = retryDelayFn ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.channelPool.withChannel(async (channelAccount) => {
          const unsignedTx = await this.escrowClient.claim(stakeId, channelAccount);
          const signedTx = unsignedTx;
          if (this.sweeperKeypair) {
            signedTx.sign(this.sweeperKeypair);
          }
          const result = (await this.escrowClient.submitAndWait(signedTx)) as { hash?: string };
          return {
            txHash: result.hash ?? signedTx.hash().toString('hex'),
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

  async submitExtendTtl(
    stakeId: bigint | number,
    retryDelayFn?: ((ms: number) => Promise<void>) | undefined
  ): Promise<{ txHash: string }> {
    const sleep = retryDelayFn ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.channelPool.withChannel(async (channelAccount) => {
          const unsignedTx = await this.escrowClient.extendTtl(stakeId, channelAccount);
          const signedTx = unsignedTx;
          if (this.sweeperKeypair) {
            signedTx.sign(this.sweeperKeypair);
          }
          const result = (await this.escrowClient.submitAndWait(signedTx)) as { hash?: string };
          return {
            txHash: result.hash ?? signedTx.hash().toString('hex'),
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
