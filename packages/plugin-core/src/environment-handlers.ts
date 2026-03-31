import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { envRegistry, workspaceStore, workspaceEnvironmentLinkStore, sessionStore, sqlite } from "@grackle-ai/database";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import { adapterManager } from "@grackle-ai/core";
import { tokenPush } from "@grackle-ai/core";
import { parseAdapterConfig } from "@grackle-ai/core";
import { emit } from "@grackle-ai/core";
import { recoverSuspendedSessions } from "@grackle-ai/core";
import { clearReconnectState } from "@grackle-ai/core";
import { logger } from "@grackle-ai/core";
import { envRowToProto } from "./grpc-proto-converters.js";
import { killSessionAndCleanup } from "./grpc-shared.js";
import { resolveBootstrapRuntime } from "@grackle-ai/core";

/** List all registered environments. */
export async function listEnvironments(): Promise<grackle.EnvironmentList> {
  const rows = envRegistry.listEnvironments();
  return create(grackle.EnvironmentListSchema, {
    environments: rows.map(envRowToProto),
  });
}

/** Register a new environment. */
export async function addEnvironment(req: grackle.AddEnvironmentRequest): Promise<grackle.Environment> {
  if (!req.displayName || !req.adapterType) {
    throw new ConnectError("displayName and adapterType required", Code.InvalidArgument);
  }
  const id = req.displayName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  envRegistry.addEnvironment(
    id,
    req.displayName,
    req.adapterType,
    req.adapterConfig,
  );
  emit("environment.changed", {});
  logger.info({ environmentId: id, adapterType: req.adapterType }, "Environment added");
  const row = envRegistry.getEnvironment(id);
  return envRowToProto(row!);
}

/** Update an existing environment's display name and/or adapter config. */
export async function updateEnvironment(req: grackle.UpdateEnvironmentRequest): Promise<grackle.Environment> {
  if (!req.id) {
    throw new ConnectError("id is required", Code.InvalidArgument);
  }
  const existing = envRegistry.getEnvironment(req.id);
  if (!existing) {
    throw new ConnectError(`Environment not found: ${req.id}`, Code.NotFound);
  }
  const displayName = req.displayName !== undefined ? req.displayName : undefined;
  if (displayName?.trim() === "") {
    throw new ConnectError("Environment name cannot be empty", Code.InvalidArgument);
  }
  let adapterConfig: string | undefined;
  if (req.adapterConfig !== undefined) {
    const raw = req.adapterConfig.trim() || "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConnectError("adapterConfig is not valid JSON", Code.InvalidArgument);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ConnectError("adapterConfig must be a JSON object", Code.InvalidArgument);
    }
    adapterConfig = raw;
  }
  const trimmedName = displayName !== undefined ? displayName.trim() : undefined;
  if (trimmedName === undefined && adapterConfig === undefined) {
    throw new ConnectError("No updatable fields provided", Code.InvalidArgument);
  }
  envRegistry.updateEnvironment(req.id, {
    displayName: trimmedName,
    adapterConfig,
  });
  logger.info({ environmentId: req.id, displayName: trimmedName }, "Environment updated");
  emit("environment.changed", {});
  const updated = envRegistry.getEnvironment(req.id);
  return envRowToProto(updated!);
}

/** Remove an environment after disconnecting it and cleaning up references. */
export async function removeEnvironment(req: grackle.EnvironmentId): Promise<grackle.Empty> {
  // Block deletion if workspaces still reference this environment as primary
  const wsCount = workspaceStore.countWorkspacesByEnvironment(req.id);
  if (wsCount > 0) {
    throw new ConnectError(
      `Cannot remove environment: ${wsCount} active workspace(s) still reference it. Archive or reparent them first.`,
      Code.FailedPrecondition,
    );
  }
  // Stop auto-reconnect attempts for this environment
  clearReconnectState(req.id);
  // Disconnect the adapter if currently connected
  const env = envRegistry.getEnvironment(req.id);
  if (env) {
    const adapter = adapterManager.getAdapter(env.adapterType);
    if (adapter) {
      try {
        await adapter.disconnect(req.id);
      } catch {
        /* best-effort */
      }
    }
  }
  adapterManager.removeConnection(req.id);
  // Delete links, sessions, and environment atomically to prevent partial cleanup
  // if a concurrent LinkEnvironment RPC races between steps.
  const conn = sqlite;
  if (conn) {
    conn.transaction(() => {
      workspaceEnvironmentLinkStore.deleteLinksForEnvironment(req.id);
      sessionStore.deleteByEnvironment(req.id);
      envRegistry.removeEnvironment(req.id);
    })();
  } else {
    workspaceEnvironmentLinkStore.deleteLinksForEnvironment(req.id);
    sessionStore.deleteByEnvironment(req.id);
    envRegistry.removeEnvironment(req.id);
  }
  emit("environment.changed", {});
  emit("environment.removed", { environmentId: req.id });
  logger.info({ environmentId: req.id }, "Environment removed");
  return create(grackle.EmptySchema, {});
}

/** Provision (bootstrap + connect) an environment, streaming progress events. */
export async function* provisionEnvironment(req: grackle.ProvisionEnvironmentRequest): AsyncGenerator<grackle.ProvisionEvent> {
  // Manual provision overrides auto-reconnect
  clearReconnectState(req.id);
  const env = envRegistry.getEnvironment(req.id);
  if (!env) {
    yield create(grackle.ProvisionEventSchema, {
      stage: "error",
      message: `Environment not found: ${req.id}`,
      progress: 0,
    });
    return;
  }

  const adapter = adapterManager.getAdapter(env.adapterType);
  if (!adapter) {
    yield create(grackle.ProvisionEventSchema, {
      stage: "error",
      message: `No adapter for type: ${env.adapterType}`,
      progress: 0,
    });
    return;
  }

  // Force teardown: kill active session, disconnect adapter, clear connection
  if (req.force) {
    const activeSession = sessionStore.getActiveForEnv(req.id);
    if (activeSession) {
      killSessionAndCleanup(activeSession);
    }
    try {
      await adapter.disconnect(req.id);
    } catch {
      // best-effort teardown
    }
    adapterManager.removeConnection(req.id);
  }

  envRegistry.updateEnvironmentStatus(req.id, "connecting");
  emit("environment.changed", {});

  const config = parseAdapterConfig(env.adapterConfig);
  config.defaultRuntime = resolveBootstrapRuntime(env);
  const powerlineToken = env.powerlineToken;

  try {
    for await (const event of reconnectOrProvision(
      req.id,
      adapter,
      config,
      powerlineToken,
      !!env.bootstrapped,
      req.force,
    )) {
      yield create(grackle.ProvisionEventSchema, {
        stage: event.stage,
        message: event.message,
        progress: event.progress,
      });
    }
  } catch (err) {
    logger.error({ environmentId: req.id, err }, "Provision/bootstrap failed");
    const currentEnv = envRegistry.getEnvironment(req.id);
    if (currentEnv?.status !== "connected") {
      envRegistry.updateEnvironmentStatus(req.id, "error");
      emit("environment.changed", {});
    }
    yield create(grackle.ProvisionEventSchema, {
      stage: "error",
      message: `Provision failed: ${err instanceof Error ? err.message : String(err)}`,
      progress: 0,
    });
    return;
  }

  try {
    const conn = await adapter.connect(req.id, config, powerlineToken);
    adapterManager.setConnection(req.id, conn);
    // Push stored tokens to newly connected environment
    await tokenPush.pushToEnv(req.id);
    envRegistry.updateEnvironmentStatus(req.id, "connected");
    envRegistry.markBootstrapped(req.id);
    emit("environment.changed", {});
    // Auto-recover suspended sessions (fire-and-forget)
    recoverSuspendedSessions(req.id, conn).catch((err) => {
      logger.error({ environmentId: req.id, err }, "Session recovery failed");
    });
  } catch (err) {
    // adapter.connect() actually failed
    envRegistry.updateEnvironmentStatus(req.id, "error");
    emit("environment.changed", {});
    yield create(grackle.ProvisionEventSchema, {
      stage: "error",
      message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      progress: 0,
    });
    return;
  }

  logger.info({ environmentId: req.id }, "Environment provisioned");

  // Best-effort: notify client that provision completed.
  // If the client already disconnected (e.g. fire-and-forget fetch in
  // test helpers), the yield throws — but the environment IS connected,
  // so we must NOT revert the status to "error".
  try {
    yield create(grackle.ProvisionEventSchema, {
      stage: "ready",
      message: "Environment connected",
      progress: 1,
    });
  } catch {
    // Client disconnected after successful provision — ignore
  }
}

/** Stop (disconnect) an environment. */
export async function stopEnvironment(req: grackle.EnvironmentId): Promise<grackle.Empty> {
  const env = envRegistry.getEnvironment(req.id);
  if (!env) {
    throw new ConnectError(`Environment not found: ${req.id}`, Code.NotFound);
  }

  const adapter = adapterManager.getAdapter(env.adapterType);
  if (adapter) {
    await adapter.stop(req.id, parseAdapterConfig(env.adapterConfig));
  }
  adapterManager.removeConnection(req.id);
  envRegistry.updateEnvironmentStatus(req.id, "disconnected");
  emit("environment.changed", {});
  logger.info({ environmentId: req.id }, "Environment stopped");
  return create(grackle.EmptySchema, {});
}

/** Destroy an environment and its underlying resources. */
export async function destroyEnvironment(req: grackle.EnvironmentId): Promise<grackle.Empty> {
  const env = envRegistry.getEnvironment(req.id);
  if (!env) {
    throw new ConnectError(`Environment not found: ${req.id}`, Code.NotFound);
  }

  const adapter = adapterManager.getAdapter(env.adapterType);
  if (adapter) {
    await adapter.destroy(req.id, parseAdapterConfig(env.adapterConfig));
  }
  adapterManager.removeConnection(req.id);
  envRegistry.updateEnvironmentStatus(req.id, "disconnected");
  emit("environment.changed", {});
  logger.info({ environmentId: req.id }, "Environment destroyed");
  return create(grackle.EmptySchema, {});
}
