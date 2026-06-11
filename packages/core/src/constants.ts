/**
 * Shared timeout, delay, and retry constants for the core (server) layer.
 *
 * Values are tuned for the server-layer use cases described in each constant's
 * TSDoc. Centralised here so all core modules reference the same source of truth
 * and values don't drift independently.
 *
 * @module
 */

// ─── Auto-reconnect ───────────────────────────────────────────

/**
 * Initial delay before the first reconnect attempt (milliseconds).
 * 10s is conservative: environments that just went unreachable may still be
 * booting or restarting, so an immediate retry would almost always fail.
 */
export const RECONNECT_INITIAL_DELAY_MS: number = 10_000;

/**
 * Maximum number of reconnect attempts before transitioning an environment to
 * the `sleeping` state for periodic probing. The exponential backoff delay is
 * capped at {@link RECONNECT_MAX_DELAY_MS}, so retries 4+ each wait 120s.
 */
export const RECONNECT_MAX_RETRIES: number = 5;

/**
 * Upper bound on the computed exponential-backoff delay (milliseconds).
 * Caps the wait at 2 minutes so a misbehaving environment doesn't stall the
 * reconnect loop indefinitely.
 */
export const RECONNECT_MAX_DELAY_MS: number = 120_000;

/**
 * Multiplier applied to the delay after each failed reconnect attempt.
 * Standard 2× exponential backoff.
 */
export const RECONNECT_BACKOFF_MULTIPLIER: number = 2;

/**
 * Interval between connectivity probes for sleeping environments (milliseconds).
 * 60s keeps probe traffic minimal while still detecting a wakeup within a minute.
 */
export const PROBE_INTERVAL_MS: number = 60_000;

// ─── Webhook delivery ────────────────────────────────────────

/**
 * Timeout per webhook delivery attempt (milliseconds).
 * 10s is enough for a healthy downstream HTTP endpoint; slow endpoints are
 * retried rather than waited on.
 */
export const WEBHOOK_TIMEOUT_MS: number = 10_000;

/**
 * Total delivery attempts for a webhook (1 initial + retries).
 * Three attempts give two retries without hammering a temporarily-down endpoint.
 */
export const WEBHOOK_MAX_ATTEMPTS: number = 3;

/**
 * Delay before the first webhook retry (milliseconds).
 * 500ms gives the downstream service a brief recovery window without
 * introducing noticeable latency in the common (success) case.
 */
export const WEBHOOK_RETRY_DELAY_MS: number = 500;

/**
 * Backoff multiplier applied after each failed webhook delivery.
 * Standard 2× exponential backoff.
 */
export const WEBHOOK_BACKOFF_MULTIPLIER: number = 2;

/**
 * Upper bound on the computed webhook retry delay (milliseconds).
 * Caps backoff at 5s so total delivery time stays bounded.
 */
export const WEBHOOK_MAX_DELAY_MS: number = 5_000;

// ─── GitHub CLI timeouts ─────────────────────────────────────

/**
 * Timeout for `gh auth status` subprocess calls (milliseconds).
 * 10s is generous for a local CLI invocation; longer suggests a hung
 * credential helper rather than a slow response.
 */
export const GH_AUTH_STATUS_TIMEOUT_MS: number = 10_000;

/**
 * Timeout for `gh auth token` subprocess calls (milliseconds).
 * Shorter than `gh auth status` because token retrieval only reads a cached
 * credential — it should be near-instant.
 */
export const GH_AUTH_TOKEN_TIMEOUT_MS: number = 5_000;
