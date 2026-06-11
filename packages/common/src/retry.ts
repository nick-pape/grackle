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
  /**
   * Called before sleeping between retries. Return `false` to stop retrying and
   * rethrow the error immediately (fail-fast for non-transient failures). When
   * omitted, every error is retried up to `maxAttempts` times.
   */
  shouldRetry?: (error: unknown) => boolean;
  /** Called after each failed attempt, before the backoff sleep. */
  onRetry?: (attempt: number, error: unknown) => void | Promise<void>;
  /** Override the sleep implementation (primarily for testing). */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `operation` up to {@link RetryOptions.maxAttempts} times, sleeping
 * with optional exponential backoff between failures.
 *
 * @throws The error from the last failed attempt when all attempts are exhausted,
 * or immediately when `shouldRetry` returns `false`.
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
    shouldRetry,
    onRetry,
    sleep = defaultSleep,
  } = options;

  if (maxAttempts < 1) {
    throw new RangeError(`retryWithBackoff: maxAttempts must be at least 1, got ${maxAttempts}`);
  }

  let lastError: unknown;
  let currentDelay = Math.min(delayMs, maxDelayMs);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      const isLast = attempt === maxAttempts;
      const retryable = !shouldRetry || shouldRetry(err);

      if (isLast || !retryable) {
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
