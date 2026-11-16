import { FixedWindowLimiter } from "./fixed-window-limiter.js";

describe("FixedWindowLimiter", () => {
  it("allows up to the limit in a window and refuses the next one", () => {
    const limiter = new FixedWindowLimiter(3, 60_000);
    expect(limiter.hit("a", 0)).toBe(true);
    expect(limiter.hit("a", 1)).toBe(true);
    expect(limiter.hit("a", 2)).toBe(true);
    expect(limiter.hit("a", 3)).toBe(false);
    expect(limiter.hit("a", 59_999)).toBe(false);
  });

  it("counts each key on its own", () => {
    const limiter = new FixedWindowLimiter(1, 60_000);
    expect(limiter.hit("a", 0)).toBe(true);
    expect(limiter.hit("a", 1)).toBe(false);
    expect(limiter.hit("b", 1)).toBe(true);
  });

  it("starts a fresh window once the old one has ended", () => {
    const limiter = new FixedWindowLimiter(1, 60_000);
    expect(limiter.hit("a", 0)).toBe(true);
    expect(limiter.hit("a", 30_000)).toBe(false);
    expect(limiter.hit("a", 60_000)).toBe(true);
    expect(limiter.hit("a", 60_001)).toBe(false);
  });

  it("says how many seconds are left to wait, and 0 when not limited", () => {
    const limiter = new FixedWindowLimiter(1, 60_000);
    expect(limiter.retryAfterSeconds("a", 0)).toBe(0);
    limiter.hit("a", 0);
    expect(limiter.retryAfterSeconds("a", 1)).toBe(0); // at the limit, not over it
    limiter.hit("a", 1);
    expect(limiter.retryAfterSeconds("a", 1_000)).toBe(59);
    expect(limiter.retryAfterSeconds("a", 60_000)).toBe(0);
  });

  it("forgets keys of finished windows so memory does not grow", () => {
    const limiter = new FixedWindowLimiter(1, 1_000);
    for (let i = 0; i < 100; i += 1) limiter.hit(`key-${i}`, 0);
    limiter.hit("late", 5_000);
    expect(
      (limiter as unknown as { windows: Map<string, unknown> }).windows.size,
    ).toBe(1);
  });
});
