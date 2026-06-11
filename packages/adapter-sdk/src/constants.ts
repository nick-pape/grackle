/**
 * Shared timeout, delay, and retry constants for the adapter layer.
 *
 * Values are tuned for the adapter-layer use cases described in each constant's
 * TSDoc. Centralised here so all adapters reference the same source of truth
 * and values don't drift independently.
 *
 * @module
 */

// ─── SSH ─────────────────────────────────────────────────────

/**
 * Timeout for the initial SSH connectivity test (milliseconds).
 * 15s gives enough headroom for a cold-start SSH server while keeping
 * provisioning failures fast to detect.
 */
export const SSH_CONNECTIVITY_TIMEOUT_MS: number = 15_000;

/**
 * Default timeout for remote command execution via SSH (milliseconds).
 * 60s covers the majority of short remote commands; callers that run
 * long-running operations (installs, builds) should pass an explicit override.
 */
export const REMOTE_EXEC_DEFAULT_TIMEOUT_MS: number = 60_000;

/**
 * Timeout for remote file-copy operations (milliseconds).
 * 2 minutes covers large PowerLine binaries over a slow SSH link.
 * Shared between adapter-ssh and adapter-codespace which perform identical
 * SCP/gh-codespace-cp operations.
 */
export const REMOTE_COPY_TIMEOUT_MS: number = 120_000;

// ─── Connect / retry ─────────────────────────────────────────

/**
 * Delay between connect-with-retry attempts (milliseconds).
 * 1.5s is intentionally aggressive: tunnel setup is fast (~100ms) so
 * waiting longer just delays the first successful connection.
 */
export const CONNECT_RETRY_DELAY_MS: number = 1_500;

/**
 * Maximum number of connect-with-retry attempts before giving up.
 * At 1.5s delay this allows ~15s of total wait time.
 */
export const CONNECT_MAX_RETRIES: number = 10;

// ─── Tunnel / port probing ────────────────────────────────────

/**
 * Delay between port-availability polls when waiting for a tunnel to open
 * (milliseconds). Short because tunnel processes bind quickly once the SSH
 * connection is established.
 */
export const TUNNEL_PORT_POLL_DELAY_MS: number = 500;

/**
 * Maximum number of port-availability poll attempts.
 * At 500ms delay this allows 10s of total wait time.
 */
export const TUNNEL_PORT_POLL_MAX_ATTEMPTS: number = 20;

/**
 * Grace period before sending SIGKILL to a tunnel process that did not exit
 * cleanly after SIGTERM (milliseconds).
 */
export const TUNNEL_KILL_GRACE_MS: number = 1_000;

/**
 * Delay after spawning a reverse tunnel before checking readiness
 * (milliseconds). Reverse tunnels bind on the remote side so local port
 * probing is not applicable; a short settle delay substitutes.
 */
export const REVERSE_TUNNEL_SETTLE_MS: number = 3_000;
