/**
 * services/oracle/src/channelPool.ts
 * Channel Account Pool for parallel Stellar transaction submission without sequence-number collisions.
 * README: "Use a channel account pool so the oracle and sweeper can submit in parallel without sequence-number collisions."
 */

export class ChannelAccountPool {
  private readonly availableChannels: string[] = [];
  private readonly allChannels: string[] = [];
  private readonly waitingQueue: ((channel: string) => void)[] = [];

  constructor(channelAccounts: string[]) {
    if (!channelAccounts || channelAccounts.length === 0) {
      throw new Error('ChannelAccountPool requires at least one channel account');
    }
    this.allChannels = [...channelAccounts];
    this.availableChannels = [...channelAccounts];
  }

  get totalCount(): number {
    return this.allChannels.length;
  }

  get availableCount(): number {
    return this.availableChannels.length;
  }

  /**
   * Acquires an available channel account from the pool.
   * If all channels are currently busy, waits until one is released.
   */
  async acquire(): Promise<string> {
    const channel = this.availableChannels.pop();
    if (channel) {
      return channel;
    }

    return new Promise<string>((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }

  /**
   * Releases a channel account back to the pool.
   */
  release(channel: string): void {
    const nextInQueue = this.waitingQueue.shift();
    if (nextInQueue) {
      nextInQueue(channel);
    } else {
      this.availableChannels.push(channel);
    }
  }

  /**
   * Executes a callback using an acquired channel account and automatically releases it.
   */
  async withChannel<T>(operation: (channel: string) => Promise<T>): Promise<T> {
    const channel = await this.acquire();
    try {
      return await operation(channel);
    } finally {
      this.release(channel);
    }
  }
}
