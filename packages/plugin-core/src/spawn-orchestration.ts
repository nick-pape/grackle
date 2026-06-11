/**
 * Shared spawn orchestration utilities extracted from session-handlers and
 * task-handlers. Encapsulates the post-session-creation wiring that both
 * `spawnAgent` and `startTask` share: lifecycle streams, stdin, IPC pipes,
 * event processing, and response building.
 *
 * @module
 */

import type { PipeMode } from "@grackle-ai/common";
import { DEFAULT_MCP_PORT, UnavailableError, PreconditionError } from "@grackle-ai/common";
import type {
  ServerActionEnvelope,
  PowerLineConnection,
  ProvisionEvent,
} from "@grackle-ai/adapter-sdk";
import type { EnvironmentRow } from "@grackle-ai/database";
import { getDatabaseStores } from "@grackle-ai/database";
import {
  streamRegistry,
  pipeDelivery,
  processEventStream,
  ensureStdinStream,
  adapterManager,
  isReconnecting,
  emit,
  logger,
  parseAdapterConfig,
  resolveBootstrapRuntime,
  type EventStreamOptions,
} from "@grackle-ai/core";
import { toDialableHost } from "./grpc-shared.js";
import { sessionRowToProto } from "./grpc-proto-converters.js";
import type { grackle } from "@grackle-ai/common";
import { runProvisionLoop } from "./provision-loop.js";

/**
 * Return a live connection for the given environment, auto-provisioning it if
 * it is currently disconnected. The environment ID is derived from `env.id`.
 *
 * When a connection already exists it is returned immediately. Otherwise the
 * environment is provisioned via {@link reconnectOrProvision} and then
 * connected. Progress is broadcast as `environment.provision_progress` events.
 *
 * Throws {@link UnavailableError} if an auto-reconnect is already in flight.
 * Throws {@link PreconditionError} if no adapter is registered for the
 * environment's type, or if provisioning or connecting fails.
 */
export async function ensureSpawnConnection(env: EnvironmentRow): Promise<PowerLineConnection> {
  const environmentId = env.id;
  const existing = adapterManager.getConnection(environmentId);
  if (existing) {
    return existing;
  }

  // If auto-reconnect is already in-flight for this environment, fail fast
  // rather than racing with a duplicate provision attempt that could overwrite
  // the connection, collide on session recovery, or open duplicate tunnels.
  if (isReconnecting(environmentId)) {
    throw new UnavailableError(`Environment ${environmentId} is reconnecting — retry shortly`);
  }

  // Auto-provision: attempt to reconnect/provision a disconnected environment
  const adapter = adapterManager.getAdapter(env.adapterType);
  if (!adapter) {
    throw new PreconditionError(`No adapter for type: ${env.adapterType}`);
  }

  // Parse config before flipping status to "connecting" — parseAdapterConfig
  // can throw on invalid JSON, and a throw here would leave the environment
  // stuck in "connecting" with no follow-up error status/event.
  const config = parseAdapterConfig(env.adapterConfig);
  config.defaultRuntime = resolveBootstrapRuntime(env);
  const powerlineToken = env.powerlineToken;

  logger.info({ environmentId }, "Auto-provisioning environment for SpawnAgent");

  // Drive the shared provision loop manually so we can both forward each
  // progress event as an emit AND capture the returned PowerLineConnection.
  // for...of discards the generator's TReturn value, so we use gen.next().
  const gen = runProvisionLoop(environmentId, adapter, config, powerlineToken, !!env.bootstrapped);
  // Definite-assignment assertion: always assigned before use or thrown in catch.
  let step!: Awaited<ReturnType<typeof gen.next>>;
  try {
    step = await gen.next();
    while (!step.done) {
      const ev = step.value as ProvisionEvent;
      logger.info({ environmentId, stage: ev.stage }, "Auto-provision progress (SpawnAgent)");
      emit("environment.provision_progress", {
        environmentId,
        stage: ev.stage,
        message: ev.message,
        progress: ev.progress,
      });
      step = await gen.next();
    }
  } catch (err) {
    logger.error({ environmentId, err }, "Auto-provision failed (SpawnAgent)");
    // If err originated in the loop body (e.g. emit threw) rather than inside
    // the generator itself, the generator is still suspended at its last yield
    // and its error-handling path (status→error, event) hasn't run yet.
    // Forward the error so runProvisionLoop can clean up, then discard the
    // re-thrown ProvisionLoopError — we produce our own PreconditionError below.
    try {
      await gen.throw(err);
    } catch {
      // Expected: runProvisionLoop re-throws as ProvisionLoopError.
    }
    throw new PreconditionError(
      `Failed to auto-connect environment ${environmentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // step.done === true; step.value is the live PowerLineConnection
  const conn = step.value as PowerLineConnection;
  emit("environment.provision_progress", {
    environmentId,
    stage: "ready",
    message: "Environment connected",
    progress: 1,
  });
  logger.info({ environmentId }, "Auto-provision complete (SpawnAgent)");
  return conn;
}

/** Build the MCP endpoint URL from environment variables or defaults. */
export function buildMcpUrl(): string {
  const port = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const host = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
  return `http://${host}:${port}/mcp`;
}

/** Parameters for the shared post-creation spawn wiring. */
export interface SpawnTailParams {
  sessionId: string;
  parentSessionId: string;
  pipeMode: PipeMode | "";
  transportStream: AsyncIterable<ServerActionEnvelope>;
  eventContext: EventStreamOptions;
}

/**
 * Execute the shared spawn tail: lifecycle stream, stdin, IPC pipes,
 * event processing, and proto response assembly. Both `spawnAgent` and
 * `startTask` call this after creating the session row and transport stream.
 */
export function executeSpawnTail(params: SpawnTailParams): grackle.Session {
  const { sessionStore } = getDatabaseStores();
  const { sessionId, parentSessionId, pipeMode, transportStream, eventContext } = params;

  const lifecycleStream = streamRegistry.createStream(`lifecycle:${sessionId}`);
  const spawnerId = parentSessionId || "__server__";
  streamRegistry.subscribe(lifecycleStream.id, spawnerId, "rw", "detach", true);
  streamRegistry.subscribe(lifecycleStream.id, sessionId, "rw", "detach", false);

  ensureStdinStream(sessionId);

  let pipeFd = 0;
  if (pipeMode && pipeMode !== "detach" && parentSessionId) {
    const ipcStream = streamRegistry.createStream(`pipe:${sessionId}`);
    const parentSub = streamRegistry.subscribe(
      ipcStream.id,
      parentSessionId,
      "rw",
      pipeMode === "sync" ? "sync" : "async",
      true,
    );
    streamRegistry.subscribe(ipcStream.id, sessionId, "rw", "async", false);
    pipeFd = parentSub.fd;

    if (pipeMode === "async") {
      pipeDelivery.ensureAsyncDeliveryListener(parentSessionId);
      pipeDelivery.ensureAsyncDeliveryListener(sessionId);
    }
  }

  processEventStream(transportStream, eventContext);

  const row = sessionStore.getSession(sessionId);
  const proto = sessionRowToProto(row!);
  proto.pipeFd = pipeFd;
  return proto;
}
