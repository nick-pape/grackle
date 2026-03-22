import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import * as envRegistry from "./env-registry.js";
import * as adapterManager from "./adapter-manager.js";
import * as tokenBroker from "./token-broker.js";
import { recoverSuspendedSessions } from "./session-recovery.js";
import { emit } from "./event-bus.js";
import { logger } from "./logger.js";

// ─── Constants ──────────────────────────────────────────────

/** Initial delay before first reconnect attempt (milliseconds). */
const RECONNECT_INITIAL_DELAY_MS: number = 10_000;

/** Maximum number of reconnect attempts before giving up. */
const RECONNECT_MAX_RETRIES: number = 5;

/** Maximum delay between reconnect attempts (milliseconds). */
const RECONNECT_MAX_DELAY_MS: number = 120_000;

/** Multiplier for exponential backoff. */
const RECONNECT_BACKOFF_MULTIPLIER: number = 2;

// ─── State ──────────────────────────────────────────────────

/** Per-environment retry state for exponential backoff. */
interface ReconnectState {
  /** Number of reconnect attempts made so far. */
  attempts: number;
  /** Earliest timestamp (Date.now()) at which the next attempt is allowed. */
  nextRetryAt: number;
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
  const disconnected = environments.filter((env) => env.status === "disconnected");

  for (const env of disconnected) {
    const state = reconnectStates.get(env.id);

    // First time seeing this environment disconnected — initialize state with delay
    if (!state) {
      reconnectStates.set(env.id, {
        attempts: 0,
        nextRetryAt: Date.now() + RECONNECT_INITIAL_DELAY_MS,
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

  // Clean up state for environments that are no longer disconnected
  for (const [envId] of reconnectStates) {
    const env = environments.find((e) => e.id === envId);
    if (env?.status !== "disconnected") {
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

/** @internal Reset all reconnect state for testing. */
export function _resetForTesting(): void {
  reconnectStates.clear();
  reconnecting.clear();
}

// ─── Internal ───────────────────────────────────────────────

/**
 * Attempt to reconnect a single disconnected environment.
 * Uses the existing `reconnectOrProvision` flow from adapter-sdk.
 */
async function tryReconnect(environmentId: string): Promise<void> {
  reconnecting.add(environmentId);

  try {
    // Re-fetch environment in case it was removed while waiting
    const env = envRegistry.getEnvironment(environmentId);
    if (!env) {
      reconnectStates.delete(environmentId);
      return;
    }

    const adapter = adapterManager.getAdapter(env.adapterType);
    if (!adapter) {
      logger.warn({ environmentId, adapterType: env.adapterType }, "No adapter registered — skipping reconnect");
      return;
    }

    logger.info({ environmentId, adapterType: env.adapterType }, "Attempting auto-reconnect");
    envRegistry.updateEnvironmentStatus(environmentId, "connecting");
    emit("environment.changed", {});

    const config = JSON.parse(env.adapterConfig) as Record<string, unknown>;
    config.defaultRuntime = env.defaultRuntime;
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
      await tokenBroker.pushToEnv(environmentId, { excludeFileTokens: true });
    } else {
      await tokenBroker.pushToEnv(environmentId);
    }

    envRegistry.updateEnvironmentStatus(environmentId, "connected");
    envRegistry.markBootstrapped(environmentId);
    emit("environment.changed", {});

    // Auto-recover suspended sessions (fire-and-forget)
    recoverSuspendedSessions(environmentId, conn).catch((err) => {
      logger.error({ environmentId, err }, "Session recovery failed after auto-reconnect");
    });

    logger.info({ environmentId }, "Auto-reconnect successful");
    reconnectStates.delete(environmentId);

  } catch (err) {
    const state = reconnectStates.get(environmentId) ?? { attempts: 0, nextRetryAt: 0 };
    state.attempts++;

    if (state.attempts >= RECONNECT_MAX_RETRIES) {
      logger.error(
        { environmentId, attempts: state.attempts, err },
        "Auto-reconnect exhausted all retries — giving up",
      );
      envRegistry.updateEnvironmentStatus(environmentId, "error");
      emit("environment.changed", {});
    } else {
      const delay = Math.min(
        RECONNECT_INITIAL_DELAY_MS * Math.pow(RECONNECT_BACKOFF_MULTIPLIER, state.attempts),
        RECONNECT_MAX_DELAY_MS,
      );
      state.nextRetryAt = Date.now() + delay;
      reconnectStates.set(environmentId, state);

      logger.info(
        { environmentId, attempts: state.attempts, nextRetryInMs: delay, err: String(err) },
        "Auto-reconnect failed — will retry",
      );
      envRegistry.updateEnvironmentStatus(environmentId, "disconnected");
      emit("environment.changed", {});
    }
  } finally {
    reconnecting.delete(environmentId);
  }
}
