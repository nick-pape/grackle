/**
 * Base error for adapter failures that are permanent and must not be retried.
 *
 * Throw a subclass from `provision()` or `reconnect()` to signal to the
 * auto-reconnect loop that the environment should be marked as `error`
 * immediately with no further retry attempts. `reconnectOrProvision()`
 * re-throws this error rather than falling back to `provision()`.
 */
export class FatalAdapterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FatalAdapterError";
  }
}
