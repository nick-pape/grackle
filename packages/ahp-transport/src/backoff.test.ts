import { describe, expect, it } from "vitest";

import { exponentialBackoff } from "./backoff.js";

describe("exponentialBackoff", () => {
  it("yields a sequence that doubles up to the cap, with zero jitter", () => {
    const policy = exponentialBackoff({
      initialMs: 250,
      maxMs: 30_000,
      jitter: 0,
      random: () => 0.5,
    });
    const seq = [
      policy.next(),
      policy.next(),
      policy.next(),
      policy.next(),
      policy.next(),
      policy.next(),
      policy.next(),
      policy.next(),
    ];
    // 250, 500, 1000, 2000, 4000, 8000, 16000, 30000 (capped)
    expect(seq).toEqual([250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
  });

  it("stays at the cap after reaching it", () => {
    const policy = exponentialBackoff({
      initialMs: 250,
      maxMs: 1_000,
      jitter: 0,
      random: () => 0.5,
    });
    // 250, 500, 1000, 1000, 1000, ...
    expect(policy.next()).toBe(250);
    expect(policy.next()).toBe(500);
    expect(policy.next()).toBe(1_000);
    expect(policy.next()).toBe(1_000);
    expect(policy.next()).toBe(1_000);
  });

  it("applies symmetric jitter within ±25%", () => {
    // Step the random source through 0.0 (= -1.0 jitter factor) and 1.0 (= +1.0).
    const samples = [0, 0.25, 0.5, 0.75, 1];
    let i = 0;
    const policy = exponentialBackoff({
      initialMs: 1_000,
      maxMs: 1_000,
      jitter: 0.25,
      random: () => samples[i++ % samples.length],
    });
    // Base is 1000ms each call (already at cap). Expected:
    //   r=0   → 1 + (0*2-1)*0.25 = 0.75 → 750
    //   r=0.25→ 1 + (0.5-1)*0.25 = 0.875 → 875
    //   r=0.5 → 1 + (1.0-1)*0.25 = 1.0 → 1000
    //   r=0.75→ 1 + (1.5-1)*0.25 = 1.125 → 1125
    //   r=1   → 1 + (2-1)*0.25 = 1.25 → 1250
    expect(policy.next()).toBe(750);
    expect(policy.next()).toBe(875);
    expect(policy.next()).toBe(1_000);
    expect(policy.next()).toBe(1_125);
    expect(policy.next()).toBe(1_250);
  });

  it("reset() returns to the initial delay", () => {
    const policy = exponentialBackoff({
      initialMs: 250,
      maxMs: 30_000,
      jitter: 0,
      random: () => 0.5,
    });
    policy.next(); // 250
    policy.next(); // 500
    policy.next(); // 1000
    policy.reset();
    expect(policy.next()).toBe(250);
    expect(policy.next()).toBe(500);
  });

  it("never yields a negative delay even with extreme jitter inputs", () => {
    // Force random() = 0 which produces the -jitter factor; with jitter=1.0 the
    // factor is 0, so the result is 0 (not negative).
    const policy = exponentialBackoff({
      initialMs: 100,
      maxMs: 100,
      jitter: 1.0,
      random: () => 0,
    });
    expect(policy.next()).toBeGreaterThanOrEqual(0);
  });

  it("uses the defaults when no options are provided", () => {
    const policy = exponentialBackoff();
    // Defaults: initialMs=250, maxMs=30_000, jitter=0.25, random=Math.random.
    // We can't predict exact values, but the first call should be in [187, 313].
    const first = policy.next();
    expect(first).toBeGreaterThanOrEqual(187);
    expect(first).toBeLessThanOrEqual(313);
  });
});
