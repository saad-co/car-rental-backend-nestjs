/**
 * A fixed-window counter: at most `max` hits per key in each window of `windowMs`. Kept in memory (no new dependency), which is
 * enough here: one backend process, and the limit only has to blunt abuse of the public link routes, not be an exact meter.
 * A restart forgets the counts; two processes would each count separately.
 *
 * Express comparison: what `express-rate-limit` does with its default memory store.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Counts one hit for `key` at time `now` (milliseconds).
   * @returns true if it is allowed, false if `key` is over its limit in this window.
   */
  hit(key: string, now: number = Date.now()): boolean {
    this.sweep(now);
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    window.count += 1;
    return window.count <= this.max;
  }

  /** Seconds until `key` may try again (for the `Retry-After` header); 0 when it is not limited. */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now || window.count <= this.max) return 0;
    return Math.ceil((window.resetAt - now) / 1000);
  }

  /** Forgets windows that ended, so the map cannot grow without end. Cheap: runs at most once per window. */
  private lastSweep = 0;
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
