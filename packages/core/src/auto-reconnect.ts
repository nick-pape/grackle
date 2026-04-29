import { reconnectOrProvision, FatalAdapterError } from "@grackle-ai/adapter-sdk";
import { envRegistry } from "@grackle-ai/database";
import * as adapterManager from "./adapter-manager.js";
import * as tokenPush from "./token-push.js";
import { recoverSuspendedSessions } from "./session-recovery.js";
import { parseAdapterConfig } from "./adapter-config.js";
import { emit } from "./event-bus.js";
import { logger } from "./logger.js";
import { resolveBootstrapRuntime } from "./resolve-bootstrap-runtime.js";

// ─── Constants ──────────────────────────────────────────────

/** Initial delay before first reconnect attempt (milliseconds). */
const RECONNECT_INITIAL_DELAY_MS: number = 10_000;

/** Maximum number of reconnect attempts before giving up. */
const RECONNECT_MAX_RETRIES: number = 5;

/** Maximum delay between reconnect attempts (milliseconds). */
const RECONNECT_MAX_DELAY_MS: number = 120_000;

/** Multiplier for exponential backoff. */
const RECONNECT_BACKOFF_MULTIPLIER: number = 2;

/** Interval between probes for sleeping environments (milliseconds). */
const PROBE_INTERVAL_MS: number = 60_000;

// ─── State ──────────────────────────────────────────────────

/** Per-environment retry state for exponential backoff and sleeping probes. */
interface ReconnectState {
  /** Number of reconnect attempts made so far. */
  attempts: number;
  /** Earliest timestamp (Date.now()) at which the next attempt is allowed. */
  nextRetryAt: number;
  /** Timestamp (Date.now()) of the last probe for sleeping environments. */
  lastProbeAt: number;
}

/** Tracks reconnect backoff state per environment. */
const reconnectStates: Map<string, ReconnectState> = new Map<string, ReconnectState>();

/** Prevents concurrent reconnect attempts for the same environment. */
const reconnecting: Set<string> = new Set<string>();

// ─── Public API ─────────────────────────────────────────────

/**
 * Scan for disconnected environments and attempt to reconnect eligible ones.
 * Called after each heartbeat tick. Uses exponential backoff per environment
 * and a concurrency lock to prevent overlapping attempts.
 *
 * Fire-and-forget for each environment — logs errors but does not throw.
 */
export async function attemptReconnects(): Promise<void> {
  const environments = envRegistry.listEnvironments();

  // ── Phase 1: Disconnected environments (exponential backoff) ──
  const disconnected = environments.filter((env) => env.status === "disconnected");

  for (const env of disconnected) {
    const state = reconnectStates.get(env.id);

    // First time seeing this environment disconnected — initialize state with delay
    if (!state) {
      reconnectStates.set(env.id, {
        attempts: 0,
        nextRetryAt: Date.now() + RECONNECT_INITIAL_DELAY_MS,
        lastProbeAt: 0,
      });
      continue;
    }

    // Backoff not elapsed yet
    if (Date.now() < state.nextRetryAt) {
      continue;
    }

    // Max retries exhausted
    if (state.attempts >= RECONNECT_MAX_RETRIES) {
      continue;
    }

    // Already reconnecting
    if (reconnecting.has(env.id)) {
      continue;
    }

    // Attempt reconnect (fire-and-forget)
    tryReconnect(env.id).catch((err) => {
      logger.error({ environmentId: env.id, err }, "Unhandled error during auto-reconnect");
    });
  }

  // ── Phase 2: Sleeping environments (periodic probe) ──────
  const sleeping = environments.filter((env) => env.status === "sleeping");

  for (const env of sleeping) {
    // Don't auto-probe codespace environments — gh codespace ssh can
    // auto-start a stopped codespace, which is expensive.
    if (env.adapterType === "codespace") {
      continue;
    }

    const state = reconnectStates.get(env.id);

    // First time seeing this sleeping env (e.g., after server restart)
    // — initialize with lastProbeAt = now so first probe fires after interval.
    if (!state) {
      reconnectStates.set(env.id, {
        attempts: RECONNECT_MAX_RETRIES,
        nextRetryAt: 0,
        lastProbeAt: Date.now(),
      });
      continue;
    }

    // Probe interval not elapsed yet
    if (Date.now() - state.lastProbeAt < PROBE_INTERVAL_MS) {
      continue;
    }

    // Already reconnecting/probing
    if (reconnecting.has(env.id)) {
      continue;
    }

    // Attempt probe (fire-and-forget)
    tryProbe(env.id).catch((err) => {
      logger.debug({ environmentId: env.id, err }, "Unhandled error during sleeping probe");
    });
  }

  // Clean up state for environments that are no longer disconnected or sleeping
  for (const [envId] of reconnectStates) {
    const env = environments.find((e) => e.id === envId);
    if (env?.status !== "disconnected" && env?.status !== "sleeping") {
      reconnectStates.delete(envId);
    }
  }
}

/**
 * Clear reconnect state for an environment. Call when the environment is
 * manually provisioned, removed, or otherwise taken out of the reconnect cycle.
 */
export function clearReconnectState(environmentId: string): void {
  reconnectStates.delete(environmentId);
  // Note: does not cancel an in-flight tryReconnect — the lock will
  // prevent a new attempt from starting, and the in-flight one will
  // complete or fail on its own.
}

/**
 * Reset reconnect state so the environment is immediately eligible on the
 * next heartbeat tick. Unlike {@link clearReconnectState} (which deletes state,
 * causing the next tick to re-initialize with an initial delay), this sets
 * attempts to zero and nextRetryAt to now.
 */
export function resetReconnectState(environmentId: string): void {
  reconnectStates.set(environmentId, { attempts: 0, nextRetryAt: Date.now(), lastProbeAt: 0 });
}

/**
 * Return true if an auto-reconnect attempt is currently in-flight for this environment.
 * Used by `spawnAgent` to avoid racing with a concurrent auto-provision attempt.
 */
export function isReconnecting(environmentId: string): boolean {
  return reconnecting.has(environmentId);
}

/** @internal Reset all reconnect state for testing. */
export function _resetForTesting(): void {
  reconnectStates.clear();
  reconnecting.clear();
}

// ─── Internal ───────────────────────────────────────────────

/**
 * Run the reconnect/provision flow and complete the connection.
 * Shared success path for both {@link tryReconnect} and {@link tryProbe}.
 *
 * @returns `true` if the connection was established, `false` if skipped
 *          (environment removed, no adapter registered).
 */
async function connectAndRecover(environmentId: string): Promise<boolean> {
  const env = envRegistry.getEnvironment(environmentId);
  if (!env) {
    reconnectStates.delete(environmentId);
    return false;
  }

  const adapter = adapterManager.getAdapter(env.adapterType);
  if (!adapter) {
    logger.warn({ environmentId, adapterType: env.adapterType }, "No adapter registered — skipping reconnect");
    return false;
  }

  envRegistry.updateEnvironmentStatus(environmentId, "connecting");
  emit("environment.changed", {});

  const config = parseAdapterConfig(env.adapterConfig);
  config.defaultRuntime = resolveBootstrapRuntime(env);
  const powerlineToken = env.powerlineToken;

  // Run reconnectOrProvision — tries fast reconnect if supported, falls back to provision
  for await (const event of reconnectOrProvision(
    environmentId,
    adapter,
    config,
    powerlineToken,
    !!env.bootstrapped,
  )) {
    logger.debug({ environmentId, stage: event.stage, message: event.message }, "Reconnect progress");
  }

  // Establish gRPC connection
  const conn = await adapter.connect(environmentId, config, powerlineToken);
  adapterManager.setConnection(environmentId, conn);

  // Push tokens (local environments exclude file tokens)
  if (env.adapterType === "local") {
    await tokenPush.pushToEnv(environmentId, { excludeFileTokens: true });
  } else {
    await tokenPush.pushToEnv(environmentId);
  }

  envRegistry.updateEnvironmentStatus(environmentId, "connected");
  envRegistry.markBootstrapped(environmentId);
  emit("environment.changed", {});

  // Auto-recover suspended sessions (fire-and-forget)
  recoverSuspendedSessions(environmentId, conn).catch((recoverErr) => {
    logger.error({ environmentId, err: recoverErr }, "Session recovery failed after auto-reconnect");
  });

  reconnectStates.delete(environmentId);
  return true;
}

/**
 * Attempt to reconnect a single disconnected environment.
 * Uses the existing `reconnectOrProvision` flow from adapter-sdk.
 */
async function tryReconnect(environmentId: string): Promise<void> {
  reconnecting.add(environmentId);

  try {
    logger.info({ environmentId }, "Attempting auto-reconnect");
    const connected = await connectAndRecover(environmentId);
    if (connected) {
      logger.info({ environmentId }, "Auto-reconnect successful");
    }

  } catch (err) {
    // Clean up any partially-established connection to avoid leaking state
    adapterManager.removeConnection(environmentId);

    // Fatal errors (e.g., resource permanently gone) must not be retried.
    if (err instanceof FatalAdapterError) {
      logger.warn(
        { environmentId, err, errorMessage: err.message },
        "Adapter reported a fatal, non-retryable error — marking environment as error",
      );
      envRegistry.updateEnvironmentStatus(environmentId, "error");
      reconnectStates.delete(environmentId);
      emit("environment.changed", {});
      return;
    }

    const state = reconnectStates.get(environmentId) ?? { attempts: 0, nextRetryAt: 0, lastProbeAt: 0 };
    state.attempts++;

    if (state.attempts >= RECONNECT_MAX_RETRIES) {
      logger.warn(
        { environmentId, attempts: state.attempts, err },
        "Auto-reconnect exhausted all retries — entering sleeping state for periodic probing",
      );
      envRegistry.updateEnvironmentStatus(environmentId, "sleeping");
      state.lastProbeAt = Date.now();
      reconnectStates.set(environmentId, state);
      emit("environment.changed", {});
    } else {
      const delay = Math.min(
        RECONNECT_INITIAL_DELAY_MS * Math.pow(RECONNECT_BACKOFF_MULTIPLIER, state.attempts),
        RECONNECT_MAX_DELAY_MS,
      );
      state.nextRetryAt = Date.now() + delay;
      reconnectStates.set(environmentId, state);

      logger.info(
        { environmentId, attempts: state.attempts, nextRetryInMs: delay, err },
        "Auto-reconnect failed — will retry",
      );
      envRegistry.updateEnvironmentStatus(environmentId, "disconnected");
      emit("environment.changed", {});
    }
  } finally {
    reconnecting.delete(environmentId);
  }
}

/**
 * Probe a sleeping environment to check if it has become reachable.
 * On success: transitions to connected and recovers sessions.
 * On failure: stays sleeping, updates lastProbeAt, logs at debug level.
 */
async function tryProbe(environmentId: string): Promise<void> {
  reconnecting.add(environmentId);

  try {
    logger.debug({ environmentId }, "Probing sleeping environment");
    const recovered = await connectAndRecover(environmentId);
    if (recovered) {
      logger.info({ environmentId }, "Sleeping environment recovered — now connected");
    }

  } catch (err) {
    // Clean up any partially-established connection
    adapterManager.removeConnection(environmentId);

    // Stay sleeping — update lastProbeAt but do NOT increment attempts
    const state = reconnectStates.get(environmentId);
    if (state) {
      state.lastProbeAt = Date.now();
    }

    envRegistry.updateEnvironmentStatus(environmentId, "sleeping");
    emit("environment.changed", {});
    logger.debug({ environmentId, err }, "Sleeping probe failed — will retry later");
  } finally {
    reconnecting.delete(environmentId);
  }
}
