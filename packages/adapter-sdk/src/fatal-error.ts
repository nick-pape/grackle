/**
 * Base error for adapter failures that are permanent and must not be retried.
 *
 * Throw a subclass of this from any adapter method (`provision`, `reconnect`,
 * `connect`, …) to signal to the auto-reconnect loop that the environment
 * should be marked as `error` immediately with no further retry attempts.
 */
export class FatalAdapterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FatalAdapterError";
  }
}
