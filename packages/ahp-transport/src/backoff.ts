/**
 * Reconnect backoff policy used by {@link AhpClientSocket}. Pure logic — no
 * timers; callers do the actual sleeping.
 */

const DEFAULT_INITIAL_MS = 250;
const DEFAULT_MAX_MS = 30_000;
const DEFAULT_JITTER = 0.25;

/** A stateful policy that yields successive delays. */
export interface BackoffPolicy {
  /** Returns the next delay (in milliseconds) to wait before reconnecting. */
  next(): number;
  /** Resets the policy back to the initial delay (called after a successful reconnect). */
  reset(): void;
}

/** Options for {@link exponentialBackoff}. */
export interface ExponentialBackoffOptions {
  /** First delay returned by `next()`. Default 250ms. */
  readonly initialMs?: number;
  /** Cap on the delay. Default 30_000ms. */
  readonly maxMs?: number;
  /** Symmetric multiplicative jitter, e.g. 0.25 = ±25%. Default 0.25. */
  readonly jitter?: number;
  /** Random source, injectable for tests. Defaults to `Math.random`. */
  readonly random?: () => number;
}

/**
 * Returns a {@link BackoffPolicy} that doubles each call up to `maxMs`,
 * with symmetric jitter applied to each yielded value.
 */
export function exponentialBackoff(options: ExponentialBackoffOptions = {}): BackoffPolicy {
  const initialMs = options.initialMs ?? DEFAULT_INITIAL_MS;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const jitter = options.jitter ?? DEFAULT_JITTER;
  const random = options.random ?? Math.random;

  let current = initialMs;

  return {
    next(): number {
      const base = Math.min(current, maxMs);
      current = Math.min(current * 2, maxMs);
      // Symmetric jitter: scale by [1-jitter, 1+jitter].
      const jitterFactor = 1 + (random() * 2 - 1) * jitter;
      return Math.max(0, Math.round(base * jitterFactor));
    },
    reset(): void {
      current = initialMs;
    },
  };
}
