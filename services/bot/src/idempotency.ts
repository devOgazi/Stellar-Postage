/**
 * services/bot/src/idempotency.ts
 * In-memory LRU-bounded set of processed Telegram update_ids to enforce idempotency.
 */

export class IdempotencyTracker {
  private readonly processed = new Set<number | string>();
  private readonly queue: (number | string)[] = [];

  constructor(private readonly maxSize: number = 10_000) {}

  /**
   * Returns true if the update was already processed.
   * If not seen, records it and returns false.
   */
  hasOrSet(updateId: number | string): boolean {
    if (this.processed.has(updateId)) {
      return true;
    }

    this.processed.add(updateId);
    this.queue.push(updateId);

    if (this.queue.length > this.maxSize) {
      const oldest = this.queue.shift();
      if (oldest !== undefined) {
        this.processed.delete(oldest);
      }
    }

    return false;
  }

  has(updateId: number | string): boolean {
    return this.processed.has(updateId);
  }

  clear(): void {
    this.processed.clear();
    this.queue.length = 0;
  }
}
