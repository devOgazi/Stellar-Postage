export interface NonceEntry {
  expiresAt: number;
  consumed: boolean;
}

export class NonceStore {
  private nonces = new Map<string, NonceEntry>();

  set(nonce: string, expiresAt: number): void {
    this.cleanup();
    this.nonces.set(nonce, { expiresAt, consumed: false });
  }

  has(nonce: string): boolean {
    const entry = this.nonces.get(nonce);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.nonces.delete(nonce);
      return false;
    }
    return !entry.consumed;
  }

  consume(nonce: string): boolean {
    const entry = this.nonces.get(nonce);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt || entry.consumed) {
      this.nonces.delete(nonce);
      return false;
    }
    // Replay protection: immediately remove/invalidate
    this.nonces.delete(nonce);
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [nonce, entry] of this.nonces.entries()) {
      if (now > entry.expiresAt || entry.consumed) {
        this.nonces.delete(nonce);
      }
    }
  }

  clear(): void {
    this.nonces.clear();
  }
}
