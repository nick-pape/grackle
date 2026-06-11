/**
 * Shared provision-loop primitive used by both {@link ensureSpawnConnection} and
 * {@link provisionEnvironment}. Encapsulates the status-transition logic,
 * concurrent-provision race guard, and fire-and-forget session recovery that
 * both callers share.
 *
 * @module
 */

import type {
  EnvironmentAdapter,
  ProvisionEvent,
  PowerLineConnection,
} from "@grackle-ai/adapter-sdk";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import { getDatabaseStores } from "@grackle-ai/database";
import { adapterManager, emit, logger, recoverSuspendedSessions } from "@grackle-ai/core";

/**
 * Thrown by {@link runProvisionLoop} when the loop fails. The {@link phase}
 * field indicates which step failed: `"provision"` for the
 * reconnect/provision step, or `"connect"` for the `adapter.connect` step.
 *
 * Callers use `phase` to produce the appropriate error message for their
 * output surface (gRPC event vs. ConnectError).
 */
export class ProvisionLoopError extends Error {
  /** The step that failed. */
  public readonly phase: "provision" | "connect";

  constructor(phase: "provision" | "connect", cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ProvisionLoopError";
    this.phase = phase;
    this.cause = cause;
  }
}

/**
 * Shared reconnect → connect → recover loop. Flips the environment status to
 * `"connecting"`, yields each {@link ProvisionEvent} from
 * {@link reconnectOrProvision} as it arrives, then calls `adapter.connect`,
 * stores the connection, transitions status to `"connected"`, marks the
 * environment bootstrapped, and fires session recovery (fire-and-forget).
 * Returns the live {@link PowerLineConnection} as the generator's return value.
 *
 * On failure the concurrent-provision race guard is applied: if another caller
 * has already transitioned the environment to `"connected"` while this one was
 * failing, the `"connected"` status is preserved rather than reverted to
 * `"error"`. The error is then re-thrown as a {@link ProvisionLoopError} with
 * the failing {@link ProvisionLoopError.phase} set.
 *
 * **Config must be parsed before calling this function.** Passing a pre-parsed
 * `config` object ensures that a parse error never leaves the environment stuck
 * in `"connecting"` with no follow-up error status or event.
 *
 * @param environmentId - The environment to provision.
 * @param adapter - The adapter to use for provisioning and connecting.
 * @param config - Pre-parsed adapter config (call `parseAdapterConfig` first).
 * @param powerlineToken - The PowerLine authentication token.
 * @param bootstrapped - Whether the environment has been bootstrapped before.
 * @param force - When `true`, forces a full reprovision even if already bootstrapped.
 */
export async function* runProvisionLoop(
  environmentId: string,
  adapter: EnvironmentAdapter,
  config: Record<string, unknown>,
  powerlineToken: string,
  bootstrapped: boolean,
  force = false,
): AsyncGenerator<ProvisionEvent, PowerLineConnection> {
  const { envRegistry } = getDatabaseStores();

  envRegistry.updateEnvironmentStatus(environmentId, "connecting");
  emit("environment.changed", {});

  /** Track which phase is active so the catch block can tag the error. */
  let phase: "provision" | "connect" = "provision";
  try {
    for await (const event of reconnectOrProvision(
      environmentId,
      adapter,
      config,
      powerlineToken,
      bootstrapped,
      force,
    )) {
      yield event;
    }

    phase = "connect";
    const conn = await adapter.connect(environmentId, config, powerlineToken);
    adapterManager.setConnection(environmentId, conn);
    // Credentials are supplied on demand at spawn (AHP HR6), not eagerly on connect.
    envRegistry.updateEnvironmentStatus(environmentId, "connected");
    envRegistry.markBootstrapped(environmentId);
    emit("environment.changed", {});
    // Auto-recover suspended sessions (fire-and-forget)
    recoverSuspendedSessions(environmentId, conn).catch((err) => {
      logger.error({ environmentId, err }, "Session recovery failed");
    });
    return conn;
  } catch (err) {
    // Race guard: a concurrent provision may have connected this environment
    // while we were failing — keep its "connected" status rather than reverting
    // it to "error".
    const currentEnv = envRegistry.getEnvironment(environmentId);
    if (currentEnv?.status !== "connected") {
      envRegistry.updateEnvironmentStatus(environmentId, "error");
      emit("environment.changed", {});
    }
    throw new ProvisionLoopError(phase, err);
  }
}
