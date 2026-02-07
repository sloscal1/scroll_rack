import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import RateLimiter from "../../src/shared/rate-limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes a single scheduled function", async () => {
    const limiter = new RateLimiter(2);
    const result = limiter.schedule(() => Promise.resolve(42));
    await vi.runAllTimersAsync();
    expect(await result).toBe(42);
  });

  it("queues calls and executes them in order", async () => {
    const limiter = new RateLimiter(2);
    const order = [];

    const p1 = limiter.schedule(async () => { order.push(1); return 1; });
    const p2 = limiter.schedule(async () => { order.push(2); return 2; });
    const p3 = limiter.schedule(async () => { order.push(3); return 3; });

    await vi.runAllTimersAsync();

    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(await p3).toBe(3);
    expect(order).toEqual([1, 2, 3]);
  });

  it("enforces minimum interval between calls", async () => {
    vi.useRealTimers(); // Need real timers for timing test
    const limiter = new RateLimiter(10); // 100ms interval
    const times = [];

    const p1 = limiter.schedule(async () => { times.push(performance.now()); });
    const p2 = limiter.schedule(async () => { times.push(performance.now()); });

    await p2;

    expect(times).toHaveLength(2);
    const interval = times[1] - times[0];
    // Should be at least ~100ms apart (10 req/s = 100ms interval)
    expect(interval).toBeGreaterThanOrEqual(80); // small tolerance
  });

  it("returns the value from the scheduled function", async () => {
    const limiter = new RateLimiter(100);
    const result = limiter.schedule(() => Promise.resolve("hello"));
    await vi.runAllTimersAsync();
    expect(await result).toBe("hello");
  });
});
