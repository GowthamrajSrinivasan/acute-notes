/**
 * A small fixed-window rate limiter (proof of concept: in memory, per process). Production needs a shared store;
 * this exists so the routes have the right shape and the tests can pin the limits.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one hit for `key`; false once the key is over its limit for the current window. */
  hit(key: string): boolean {
    const now = this.now();
    if (this.windows.size > 5000) this.sweep(now);
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count++;
    return w.count <= this.limit;
  }

  /** Whether `key` is over its limit, without counting. */
  blocked(key: string): boolean {
    const w = this.windows.get(key);
    return !!w && this.now() - w.start < this.windowMs && w.count > this.limit;
  }

  private sweep(now: number): void {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
}
