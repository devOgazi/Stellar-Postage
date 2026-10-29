/**
 * services/sweeper/src/channelPool.ts
 * Channel Account Pool for parallel Stellar transaction submission without sequence-number collisions.
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

  async acquire(): Promise<string> {
    const channel = this.availableChannels.pop();
    if (channel) {
      return channel;
    }

    return new Promise<string>((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }

  release(channel: string): void {
    const nextInQueue = this.waitingQueue.shift();
    if (nextInQueue) {
      nextInQueue(channel);
    } else {
      this.availableChannels.push(channel);
    }
  }

  async withChannel<T>(operation: (channel: string) => Promise<T>): Promise<T> {
    const channel = await this.acquire();
    try {
      return await operation(channel);
    } finally {
      this.release(channel);
    }
  }
}
