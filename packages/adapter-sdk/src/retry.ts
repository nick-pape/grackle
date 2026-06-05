import { sleep as defaultSleep } from "./utils.js";

/** Options for {@link retryWithBackoff}. */
export interface RetryOptions {
  /** Total number of attempts (first try + retries). Must be at least 1. */
  maxAttempts: number;
  /** Delay before the first retry (milliseconds). */
  delayMs: number;
  /** Multiplier applied to the delay after each retry (default `1` = fixed delay). */
  backoffMultiplier?: number;
  /** Upper bound on the computed delay (milliseconds). Only meaningful when `backoffMultiplier` is greater than 1. */
  maxDelayMs?: number;
  /** Called after each failed attempt, before the backoff sleep. */
  onRetry?: (attempt: number, error: unknown) => void | Promise<void>;
  /** Override the sleep implementation (primarily for testing). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Execute `operation` up to {@link RetryOptions.maxAttempts} times, sleeping
 * with optional exponential backoff between failures.
 *
 * @throws The error from the last failed attempt when all attempts are exhausted.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxAttempts,
    delayMs,
    backoffMultiplier = 1,
    maxDelayMs = Infinity,
    onRetry,
    sleep = defaultSleep,
  } = options;

  let lastError: unknown;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts) {
        break;
      }

      if (onRetry) {
        await onRetry(attempt, err);
      }

      await sleep(currentDelay);
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}
