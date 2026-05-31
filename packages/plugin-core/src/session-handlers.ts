import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import type { PipeMode } from "@grackle-ai/common";
import {
  DEFAULT_MCP_PORT,
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  type SessionStatus,
  LOGS_DIR,
  eventTypeToEnum,
} from "@grackle-ai/common";
import {
  envRegistry,
  sessionStore,
  taskStore,
  personaStore,
  settingsStore,
  grackleHome,
} from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { join } from "node:path";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import { adapterManager } from "@grackle-ai/core";
import { streamHub } from "@grackle-ai/core";
import { tokenPush } from "@grackle-ai/core";
import { parseAdapterConfig } from "@grackle-ai/core";
import { emit } from "@grackle-ai/core";
import { processEventStream } from "@grackle-ai/core";
import { recoverSuspendedSessions } from "@grackle-ai/core";
import { logger } from "@grackle-ai/core";
import { reanimateAgent } from "@grackle-ai/core";
import { streamRegistry } from "@grackle-ai/core";
import {
  RESERVED_PREFIXES,
  isReservedStreamName,
  OPERATOR_PRINCIPAL,
  isOperatorPrincipal,
} from "@grackle-ai/core";
import { getLatestLiveSessionId } from "@grackle-ai/core";
import { pipeDelivery } from "@grackle-ai/core";
import { logWriter } from "@grackle-ai/core";
import { createScopedToken, loadOrCreateApiKey } from "@grackle-ai/auth";
import { resolvePersona, SystemPromptBuilder } from "@grackle-ai/prompt";
import { toPersonaResolveInput } from "@grackle-ai/core";
import { sendInputToSession } from "@grackle-ai/core";
import { deliverPendingEscalations } from "@grackle-ai/core";
import { createEventStream } from "@grackle-ai/core";
import { sessionRowToProto } from "./grpc-proto-converters.js";
import { validatePipeInputs, toDialableHost, killSessionAndCleanup } from "./grpc-shared.js";
import { resolveSpawnSelection, buildCreateSessionParams } from "./spawn-request.js";
import { personaMcpServersToJson } from "@grackle-ai/core";
import { getTraceId } from "@grackle-ai/core";
import { resolveBootstrapRuntime } from "@grackle-ai/core";
import { ensureStdinStream, publishToStdin } from "@grackle-ai/core";
import { isReconnecting } from "@grackle-ai/core";

/** Spawn a new agent session in the given environment. */
export async function spawnAgent(req: grackle.SpawnRequest): Promise<grackle.Session> {
  if (!req.environmentId) {
    throw new ConnectError("environment_id is required", Code.InvalidArgument);
  }
  const env = envRegistry.getEnvironment(req.environmentId);
  if (!env) {
    throw new ConnectError(`Environment not found: ${req.environmentId}`, Code.NotFound);
  }

  let conn = adapterManager.getConnection(req.environmentId);
  if (!conn) {
    // If auto-reconnect is already in-flight for this environment, fail fast
    // rather than racing with a duplicate provision attempt that could overwrite
    // the connection, collide on session recovery, or open duplicate tunnels.
    if (isReconnecting(req.environmentId)) {
      throw new ConnectError(
        `Environment ${req.environmentId} is reconnecting — retry shortly`,
        Code.Unavailable,
      );
    }

    // Auto-provision: attempt to reconnect/provision a disconnected environment
    const adapter = adapterManager.getAdapter(env.adapterType);
    if (!adapter) {
      throw new ConnectError(`No adapter for type: ${env.adapterType}`, Code.FailedPrecondition);
    }

    logger.info(
      { environmentId: req.environmentId },
      "Auto-provisioning environment for SpawnAgent",
    );
    envRegistry.updateEnvironmentStatus(req.environmentId, "connecting");
    emit("environment.changed", {});

    const config = parseAdapterConfig(env.adapterConfig);
    config.defaultRuntime = resolveBootstrapRuntime(env);
    const powerlineToken = env.powerlineToken;

    try {
      for await (const provEvent of reconnectOrProvision(
        req.environmentId,
        adapter,
        config,
        powerlineToken,
        !!env.bootstrapped,
      )) {
        logger.info(
          { environmentId: req.environmentId, stage: provEvent.stage },
          "Auto-provision progress (SpawnAgent)",
        );
        emit("environment.provision_progress", {
          environmentId: req.environmentId,
          stage: provEvent.stage,
          message: provEvent.message,
          progress: provEvent.progress,
        });
      }

      conn = await adapter.connect(req.environmentId, config, powerlineToken);
      adapterManager.setConnection(req.environmentId, conn);
      // Credentials are supplied on demand at spawn (AHP HR6), not eagerly on connect.
      envRegistry.updateEnvironmentStatus(req.environmentId, "connected");
      envRegistry.markBootstrapped(req.environmentId);
      emit("environment.changed", {});
      // Auto-recover suspended sessions (fire-and-forget)
      recoverSuspendedSessions(req.environmentId, conn).catch((err) => {
        logger.error({ environmentId: req.environmentId, err }, "Session recovery failed");
      });
      logger.info({ environmentId: req.environmentId }, "Auto-provision complete (SpawnAgent)");
      emit("environment.provision_progress", {
        environmentId: req.environmentId,
        stage: "ready",
        message: "Environment connected",
        progress: 1,
      });
    } catch (err) {
      logger.error({ environmentId: req.environmentId, err }, "Auto-provision failed (SpawnAgent)");
      envRegistry.updateEnvironmentStatus(req.environmentId, "error");
      emit("environment.changed", {});
      throw new ConnectError(
        `Failed to auto-connect environment ${req.environmentId}: ${err instanceof Error ? err.message : String(err)}`,
        Code.FailedPrecondition,
      );
    }
  }

  // Resolve persona via cascade (request → app default)
  let resolved: ReturnType<typeof resolvePersona>;
  try {
    resolved = resolvePersona(
      req.config?.personaId ?? "",
      undefined,
      undefined,
      settingsStore.getSetting("default_persona_id") || undefined,
      (id) => toPersonaResolveInput(personaStore.getPersona(id)),
    );
  } catch (err) {
    throw new ConnectError((err as Error).message, Code.FailedPrecondition);
  }

  const sessionId = uuid();
  const cfg = req.config;
  const parentSessionId = cfg?.parentSessionId ?? "";
  const { runtime, model } = resolveSpawnSelection(req.provider, req.model?.id ?? "", {
    runtime: resolved.runtime,
    model: resolved.model,
  });

  // Supply credentials on demand for this runtime, just before spawn (AHP HR6).
  // For local envs, skip file tokens — the PowerLine is on the same machine.
  // Runs a fail-fast pre-flight (#1316): a required-but-missing/expired credential
  // throws here, before any session row is created below.
  await tokenPush.authenticateForRuntime(
    req.environmentId,
    runtime,
    env.adapterType === "local" ? { excludeFileTokens: true } : undefined,
  );

  const maxTurns = cfg?.maxTurns || resolved.maxTurns;
  const logPath = join(grackleHome, LOGS_DIR, sessionId);

  const builderPrompt = new SystemPromptBuilder({
    personaPrompt: resolved.systemPrompt,
  }).build();
  const systemContext = cfg?.systemContext
    ? builderPrompt + "\n\n" + cfg.systemContext
    : builderPrompt;

  // Validate pipe inputs before creating the session or spawning the child
  validatePipeInputs(cfg?.pipe ?? "", parentSessionId);
  const pipeMode = (cfg?.pipe ?? "") as PipeMode;

  sessionStore.createSession(
    sessionId,
    req.environmentId,
    runtime,
    req.prompt,
    model,
    logPath,
    cfg?.taskId || "", // taskId
    resolved.personaId, // personaId
    parentSessionId, // parentSessionId
    pipeMode || "", // pipeMode
  );

  const mcpServersJson = personaMcpServersToJson(resolved.mcpServers, resolved.personaId);

  const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const mcpDialHost = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
  const mcpUrl = `http://${mcpDialHost}:${mcpPort}/mcp`;
  // Resolve workspace scope for the token: prefer explicit workspaceId, then inherit from the
  // parent session's task (for piped child sessions spawned from a task-based session).
  let resolvedWorkspaceId = cfg?.workspaceId || "";
  if (!resolvedWorkspaceId && parentSessionId) {
    const parentSession = sessionStore.getSession(parentSessionId);
    if (parentSession?.taskId) {
      const parentTask = taskStore.getTask(parentSession.taskId);
      resolvedWorkspaceId = parentTask?.workspaceId || "";
    }
  }
  const mcpToken = createScopedToken(
    { sub: sessionId, pid: resolvedWorkspaceId, per: resolved.personaId, sid: sessionId },
    loadOrCreateApiKey(grackleHome),
  );

  const workingDirectory = cfg?.branch
    ? (cfg?.workingDirectory ?? "").trim() ||
      process.env.GRACKLE_WORKING_DIRECTORY ||
      process.env.GRACKLE_WORKTREE_BASE ||
      "/workspace"
    : "";
  const createParams = buildCreateSessionParams({
    sessionId,
    runtime,
    model,
    prompt: req.prompt,
    maxTurns,
    config: cfg,
    systemContext,
    mcpServersJson,
    mcpUrl,
    mcpToken,
    scriptContent: resolved.type === "script" ? resolved.script : "",
    workingDirectory,
    workspaceId: resolvedWorkspaceId,
  });

  // Create lifecycle stream — every session gets one. The spawner holds
  // a lifecycle fd; when it's closed, the session auto-stops.
  const lifecycleStream = streamRegistry.createStream(`lifecycle:${sessionId}`);
  const spawnerId = parentSessionId || "__server__";
  streamRegistry.subscribe(lifecycleStream.id, spawnerId, "rw", "detach", true);
  streamRegistry.subscribe(lifecycleStream.id, sessionId, "rw", "detach", false);

  // Create stdin stream — routes human input through the stream-registry
  ensureStdinStream(sessionId);

  // Set up IPC pipe stream (optional, on top of lifecycle stream)
  let pipeFd = 0;
  if (pipeMode && pipeMode !== "detach" && parentSessionId) {
    const ipcStream = streamRegistry.createStream(`pipe:${sessionId}`);
    const parentSub = streamRegistry.subscribe(
      ipcStream.id,
      parentSessionId,
      "rw",
      pipeMode === "sync" ? "sync" : "async",
      true, // parent opened this via spawn
    );
    streamRegistry.subscribe(
      ipcStream.id,
      sessionId,
      "rw",
      "async",
      false, // child inherits
    );
    pipeFd = parentSub.fd;

    if (pipeMode === "async") {
      pipeDelivery.ensureAsyncDeliveryListener(parentSessionId); // parent receives child messages
      pipeDelivery.ensureAsyncDeliveryListener(sessionId); // child receives parent messages
    }
  }

  const { stream } = conn.transport.createSession(createParams);
  processEventStream(stream, {
    sessionId,
    logPath,
    systemContext,
    prompt: req.prompt,
    traceId: getTraceId(),
  });

  logger.info({ sessionId, environmentId: req.environmentId }, "Session spawned");

  const row = sessionStore.getSession(sessionId);
  const proto = sessionRowToProto(row!);
  proto.pipeFd = pipeFd;
  return proto;
}

/** Resume a previously suspended agent session. */
export async function resumeAgent(req: grackle.ResumeRequest): Promise<grackle.Session> {
  const row = reanimateAgent(req.sessionId);
  logger.info({ sessionId: req.sessionId }, "Session resumed");
  return sessionRowToProto(row);
}

/** Send text input to a running session. */
export async function sendInput(req: grackle.InputMessage): Promise<grackle.Empty> {
  const session = sessionStore.getSession(req.sessionId);
  if (!session) {
    throw new ConnectError(`Session not found: ${req.sessionId}`, Code.NotFound);
  }
  if (TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
    throw new ConnectError(
      `Session ${req.sessionId} has ended (status: ${session.status})`,
      Code.FailedPrecondition,
    );
  }

  const conn = adapterManager.getConnection(session.environmentId);
  if (!conn) {
    throw new ConnectError(
      `Environment ${session.environmentId} not connected`,
      Code.FailedPrecondition,
    );
  }

  // Persist and publish user input event so subscribers see the text in the event stream
  const userInputEvent = create(grackle.SessionEventSchema, {
    sessionId: req.sessionId,
    type: grackle.EventType.USER_INPUT,
    timestamp: new Date().toISOString(),
    content: req.text,
    raw: "",
  });
  if (session.logPath) {
    await logWriter.writeEvent(session.logPath, userInputEvent);
  }
  streamHub.publish(userInputEvent);

  logger.debug({ sessionId: req.sessionId }, "User input received");

  // Route through stdin stream — the async listener delivers to PowerLine
  publishToStdin(req.sessionId, req.text);

  return create(grackle.EmptySchema, {});
}

/** Kill (or gracefully stop) an agent session. */
export async function killAgent(req: grackle.KillAgentRequest): Promise<grackle.Empty> {
  const session = sessionStore.getSession(req.id);
  if (!session) {
    throw new ConnectError(`Session not found: ${req.id}`, Code.NotFound);
  }

  if (req.graceful) {
    // ── SIGTERM: deliver signal message, return immediately ──
    if (!TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
      const message =
        "[SIGTERM] You have been asked to stop gracefully. " +
        "Finish your current operation, save your work, close any open IPC fds " +
        "(ipc_close for each owned fd), then call task_complete (if applicable) and stop.";
      // Set sigtermSentAt BEFORE delivering so that if the session
      // completes instantly (race), the event-processor sees the flag.
      sessionStore.setSigtermSentAt(session.id);
      const delivered = await sendInputToSession(
        session.id,
        session.environmentId,
        message,
        "sigterm",
      );
      if (delivered) {
        return create(grackle.EmptySchema, {});
      }
      // Delivery failed — clear the flag since SIGTERM wasn't actually sent
      sessionStore.clearSigtermSentAt(session.id);
      // If delivery failed (env disconnected), fall through to hard kill
      logger.warn({ sessionId: session.id }, "SIGTERM delivery failed, falling back to hard kill");
    }
  }

  // ── SIGKILL: terminate immediately ──
  // Set STOPPED + killed BEFORE closing the lifecycle FD so the orphan
  // callback sees the session is already terminal and skips. Without this,
  // the orphan callback would see IDLE → reason="completed", which is wrong
  // for an explicit kill.
  killSessionAndCleanup(session);

  logger.info({ sessionId: req.id }, "Session killed");
  return create(grackle.EmptySchema, {});
}

/** Get aggregated usage stats for a session, task, task tree, workspace, or environment. */
export async function getUsage(req: grackle.GetUsageRequest): Promise<grackle.UsageStats> {
  if (!req.id) {
    throw new ConnectError("id is required", Code.InvalidArgument);
  }
  switch (req.scope) {
    case "session": {
      const session = sessionStore.getSession(req.id);
      if (!session) {
        throw new ConnectError(`Session not found: ${req.id}`, Code.NotFound);
      }
      return create(grackle.UsageStatsSchema, {
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        costMillicents: session.costMillicents,
        sessionCount: 1,
      });
    }
    case "task": {
      const usage = sessionStore.aggregateUsage({ taskId: req.id });
      return create(grackle.UsageStatsSchema, usage);
    }
    case "task_tree": {
      const descendants = taskStore.getDescendants(req.id);
      const taskIds = [req.id, ...descendants.map((d) => d.id)];
      const usage = sessionStore.aggregateUsage({ taskIds });
      return create(grackle.UsageStatsSchema, usage);
    }
    case "workspace": {
      const tasks = taskStore.listTasks(req.id);
      const taskIds = tasks.map((t) => t.id);
      const usage =
        taskIds.length > 0
          ? sessionStore.aggregateUsage({ taskIds })
          : { inputTokens: 0, outputTokens: 0, costMillicents: 0, sessionCount: 0 };
      return create(grackle.UsageStatsSchema, usage);
    }
    case "environment": {
      const usage = sessionStore.aggregateUsage({ environmentId: req.id });
      return create(grackle.UsageStatsSchema, usage);
    }
    default:
      throw new ConnectError(`Invalid usage scope: ${req.scope}`, Code.InvalidArgument);
  }
}

/** Wait for a message on a synchronous pipe subscription. */
export async function waitForPipe(
  req: grackle.WaitForPipeRequest,
): Promise<grackle.WaitForPipeResponse> {
  const sub = streamRegistry.getSubscription(req.sessionId, req.fd);
  if (!sub) {
    throw new ConnectError(
      `No subscription found for session ${req.sessionId} fd ${req.fd}`,
      Code.NotFound,
    );
  }

  if (sub.deliveryMode !== "sync") {
    throw new ConnectError(
      `Subscription fd ${req.fd} is not a sync subscription (mode: ${sub.deliveryMode})`,
      Code.FailedPrecondition,
    );
  }

  // Capture child session ID before blocking — the pipe stream may be
  // removed by a concurrent fd close while consumeSync is awaiting.
  const pipeStream = streamRegistry.getStream(sub.streamId);
  const childSessionId = pipeStream?.name.startsWith("pipe:")
    ? pipeStream.name.slice("pipe:".length)
    : undefined;

  // Use try/finally so the pipe stream (and lifecycle stream) are cleaned up
  // even if consumeSync rejects (e.g., the request is cancelled or times out)
  // to prevent unbounded memory growth. Lifecycle cleanup also orphans the child,
  // triggering auto-stop so it doesn't linger in waiting_input (#824).
  let msg: Awaited<ReturnType<typeof streamRegistry.consumeSync>>;
  try {
    msg = await streamRegistry.consumeSync(sub.id);
  } finally {
    pipeDelivery.cleanupSyncPipeAndLifecycle(sub.streamId, childSessionId);
  }

  return create(grackle.WaitForPipeResponseSchema, {
    content: msg.content,
    senderSessionId: msg.senderId,
  });
}

/** Write a message to a pipe fd. */
export async function writeToFd(req: grackle.WriteToFdRequest): Promise<grackle.Empty> {
  const sub = streamRegistry.getSubscription(req.sessionId, req.fd);
  if (!sub) {
    throw new ConnectError(
      `No subscription found for session ${req.sessionId} fd ${req.fd}`,
      Code.NotFound,
    );
  }
  if (sub.permission !== "w" && sub.permission !== "rw") {
    throw new ConnectError(
      `Subscription fd ${req.fd} does not have write permission (permission: ${sub.permission})`,
      Code.FailedPrecondition,
    );
  }

  const stream = streamRegistry.getStream(sub.streamId);
  if (!stream) {
    throw new ConnectError("Stream no longer exists", Code.FailedPrecondition);
  }

  // Publish to stream — delivery is handled by async listeners registered
  // at spawn time via ensureAsyncDeliveryListener. This is the same path
  // used by publishChildCompletion for child→parent delivery.
  const msg = streamRegistry.publish(sub.streamId, req.sessionId, req.message);

  // Await pending async deliveries (gRPC sendInput Promises) before checking
  // deliveredTo. Without this, a rejected gRPC call after dispatch would still
  // appear delivered because deliveredTo was populated synchronously.
  await streamRegistry.awaitPendingDeliveries(msg);

  // Verify delivery to async subscribers — check if the published message
  // was marked as delivered for each async target. Sync and detach subscribers
  // are excluded (sync waits for consumeSync, detach buffers silently).
  for (const targetSub of stream.subscriptions.values()) {
    if (targetSub.sessionId === req.sessionId) {
      continue;
    }
    if (targetSub.deliveryMode === "async" && !msg.deliveredTo.has(targetSub.id)) {
      throw new ConnectError(
        "Message delivery failed — target environment may be disconnected",
        Code.FailedPrecondition,
      );
    }
  }

  return create(grackle.EmptySchema, {});
}

/** Close a pipe file descriptor, optionally stopping child sessions. */
export async function closeFd(req: grackle.CloseFdRequest): Promise<grackle.CloseFdResponse> {
  const sub = streamRegistry.getSubscription(req.sessionId, req.fd);
  if (!sub) {
    throw new ConnectError(
      `No subscription found for session ${req.sessionId} fd ${req.fd}`,
      Code.NotFound,
    );
  }
  if (streamRegistry.hasUndeliveredMessages(sub.id)) {
    throw new ConnectError(
      `Cannot close fd ${req.fd}: undelivered messages pending. Process or consume them first.`,
      Code.FailedPrecondition,
    );
  }

  const streamId = sub.streamId;
  const stream = streamRegistry.getStream(streamId);

  // Only unsubscribe other participants for internal streams (pipe/lifecycle).
  // Global streams (user-created) only unsubscribe the caller — closing your
  // fd should not disconnect other participants from the shared stream.
  const isInternalStream = stream ? isReservedStreamName(stream.name) : false;

  const childSubs: Array<{ sessionId: string; subId: string }> = [];
  if (isInternalStream && stream) {
    for (const s of stream.subscriptions.values()) {
      if (s.sessionId !== req.sessionId) {
        childSubs.push({ sessionId: s.sessionId, subId: s.id });
      }
    }
  }

  // Unsubscribe the caller
  streamRegistry.unsubscribe(sub.id);

  // Also unsubscribe children on internal streams — when their last
  // subscription is removed, the lifecycle manager's orphan callback auto-stops them.
  let stopped = false;
  for (const child of childSubs) {
    streamRegistry.unsubscribe(child.subId);
    // Check if the child was orphaned (auto-stopped)
    const childSession = sessionStore.getSession(child.sessionId);
    if (childSession?.status === SESSION_STATUS.STOPPED) {
      stopped = true;
    }
  }

  // Clean up async listeners for caller and any unsubscribed children
  pipeDelivery.cleanupAsyncListenerIfEmpty(req.sessionId);
  for (const child of childSubs) {
    pipeDelivery.cleanupAsyncListenerIfEmpty(child.sessionId);
  }

  return create(grackle.CloseFdResponseSchema, { stopped });
}

/** Get all open file descriptors for a session. */
export function getSessionFds(req: grackle.SessionId): grackle.SessionFds {
  const subs = streamRegistry.getSubscriptionsForSession(req.id);
  const fds = subs.map((sub) => {
    const stream = streamRegistry.getStream(sub.streamId);
    let targetSessionId = "";
    if (stream) {
      for (const s of stream.subscriptions.values()) {
        if (s.sessionId !== req.id) {
          targetSessionId = s.sessionId;
          break;
        }
      }
    }
    return create(grackle.FdInfoSchema, {
      fd: sub.fd,
      streamName: stream?.name || "",
      permission: sub.permission,
      deliveryMode: sub.deliveryMode,
      owned: sub.createdBySpawn,
      targetSessionId,
    });
  });
  return create(grackle.SessionFdsSchema, { fds });
}

// ─── Global Stream Helpers ─────────────────────────────────────────────────────

/** Valid permission values for stream subscriptions. */
const VALID_PERMISSIONS: ReadonlySet<string> = new Set(["r", "w", "rw"]);

/** Valid delivery mode values for stream subscriptions. */
const VALID_DELIVERY_MODES: ReadonlySet<string> = new Set(["sync", "async", "detach"]);

/** Check if a requested permission is a subset of the caller's permission. */
function isPermissionSubset(requested: string, callerHas: string): boolean {
  if (callerHas === "rw") {
    return true;
  }
  return requested === callerHas;
}

/** Validate permission and deliveryMode, enforcing the w-only → detach rule. */
function validateSubscriptionParams(permission: string, deliveryMode: string): void {
  if (!VALID_PERMISSIONS.has(permission)) {
    throw new ConnectError(
      `Invalid permission "${permission}" — must be "r", "w", or "rw"`,
      Code.InvalidArgument,
    );
  }
  if (!VALID_DELIVERY_MODES.has(deliveryMode)) {
    throw new ConnectError(
      `Invalid delivery_mode "${deliveryMode}" — must be "sync", "async", or "detach"`,
      Code.InvalidArgument,
    );
  }
  if (permission === "w" && deliveryMode !== "detach") {
    throw new ConnectError(
      `Write-only permission requires delivery_mode "detach" (got "${deliveryMode}")`,
      Code.InvalidArgument,
    );
  }
}

// ─── Global Stream Handlers ────────────────────────────────────────────────────

/** Create a new named stream. Creator gets an rw/async subscription. */
export async function createStream(
  req: grackle.CreateStreamRequest,
): Promise<grackle.CreateStreamResponse> {
  if (!req.sessionId) {
    throw new ConnectError("session_id is required", Code.InvalidArgument);
  }
  if (!req.name) {
    throw new ConnectError("name is required", Code.InvalidArgument);
  }
  if (RESERVED_PREFIXES.some((prefix) => req.name.startsWith(prefix))) {
    throw new ConnectError(
      `Stream name "${req.name}" uses a reserved prefix`,
      Code.InvalidArgument,
    );
  }

  let stream;
  try {
    stream = streamRegistry.createStream(req.name, req.selfEcho);
  } catch {
    throw new ConnectError(`Stream name "${req.name}" already exists`, Code.AlreadyExists);
  }

  const sub = streamRegistry.subscribe(stream.id, req.sessionId, "rw", "async", false);
  pipeDelivery.ensureAsyncDeliveryListener(req.sessionId);

  return create(grackle.CreateStreamResponseSchema, {
    streamId: stream.id,
    fd: sub.fd,
  });
}

/** Attach another session to a stream the caller holds an fd on. */
export async function attachStream(
  req: grackle.AttachStreamRequest,
): Promise<grackle.AttachStreamResponse> {
  if (!req.sessionId) {
    throw new ConnectError("session_id is required", Code.InvalidArgument);
  }
  if (!req.targetSessionId) {
    throw new ConnectError("target_session_id is required", Code.InvalidArgument);
  }

  const callerSub = streamRegistry.getSubscription(req.sessionId, req.fd);
  if (!callerSub) {
    throw new ConnectError(
      `No subscription found for session ${req.sessionId} fd ${String(req.fd)}`,
      Code.NotFound,
    );
  }

  const permission = req.permission || "rw";
  const deliveryMode = req.deliveryMode || "async";

  validateSubscriptionParams(permission, deliveryMode);

  if (!isPermissionSubset(permission, callerSub.permission)) {
    throw new ConnectError(
      `Cannot grant "${permission}" — caller only has "${callerSub.permission}"`,
      Code.PermissionDenied,
    );
  }

  const targetSub = streamRegistry.subscribe(
    callerSub.streamId,
    req.targetSessionId,
    permission as "r" | "w" | "rw",
    deliveryMode as "sync" | "async" | "detach",
    false,
  );

  if (deliveryMode === "async") {
    pipeDelivery.ensureAsyncDeliveryListener(req.targetSessionId);
  }

  return create(grackle.AttachStreamResponseSchema, {
    fd: targetSub.fd,
  });
}

/**
 * List active IPC streams with subscriber details and message buffer depth.
 *
 * By default, internal IPC plumbing streams (reserved `lifecycle:` / `pipe:` /
 * `stdin:` prefixes) are filtered out — they are infrastructure, not user-facing
 * coordination. Set `include_internal` to surface them for debugging.
 */
export async function listStreams(
  req: grackle.ListStreamsRequest,
): Promise<grackle.ListStreamsResponse> {
  const allStreams = streamRegistry.listStreams();
  const visibleStreams = req.includeInternal
    ? allStreams
    : allStreams.filter(
        (stream) => !RESERVED_PREFIXES.some((prefix) => stream.name.startsWith(prefix)),
      );
  return create(grackle.ListStreamsResponseSchema, {
    streams: visibleStreams.map((stream) => {
      const subscribers = Array.from(stream.subscriptions.values()).map((sub) =>
        create(grackle.StreamSubscriberInfoSchema, {
          subscriptionId: sub.id,
          sessionId: sub.sessionId,
          fd: sub.fd,
          permission: sub.permission,
          deliveryMode: sub.deliveryMode,
          createdBySpawn: sub.createdBySpawn,
        }),
      );
      return create(grackle.StreamInfoSchema, {
        id: stream.id,
        name: stream.name,
        subscriberCount: stream.subscriptions.size,
        messageBufferDepth: stream.messages.length,
        subscribers,
        selfEcho: stream.selfEcho,
      });
    }),
  });
}

// ─── Operator Stream Control Plane (#1309) ─────────────────────────────────────

/**
 * Resolve a task's latest live (pending/running/idle) session, or throw if the
 * task is unknown. Shared by the operator attach/detach/list handlers.
 *
 * @param taskId - The task whose live session to resolve.
 * @returns The latest live session id, or `""` if the task has no live session.
 */
function resolveLiveSessionForTask(taskId: string): string {
  const task = taskStore.getTask(taskId);
  if (!task) {
    throw new ConnectError(`Task not found: ${taskId}`, Code.NotFound);
  }
  return getLatestLiveSessionId(sessionStore.listSessionsForTask(taskId));
}

/**
 * True if `stream` is an operator-owned room — i.e. it carries an `operator:*`
 * anchor subscription. The operator control plane only manages rooms it created;
 * it must not attach/detach/close agent-owned streams (`#1309` review).
 *
 * @param stream - The stream to inspect.
 */
function isOperatorRoom(stream: streamRegistry.Stream): boolean {
  for (const sub of stream.subscriptions.values()) {
    if (isOperatorPrincipal(sub.sessionId)) {
      return true;
    }
  }
  return false;
}

/**
 * Create an operator-owned room. Unlike {@link createStream} (agent-driven, needs
 * a creator session), this is human-driven via the server: it plants the
 * `operator:*` anchor (`rw`/`detach`) so the room survives at zero agents and
 * appears in the roster. Reserved-prefix and duplicate names are rejected.
 */
export async function operatorCreateStream(
  req: grackle.OperatorCreateStreamRequest,
): Promise<grackle.OperatorCreateStreamResponse> {
  if (!req.name) {
    throw new ConnectError("name is required", Code.InvalidArgument);
  }
  if (RESERVED_PREFIXES.some((prefix) => req.name.startsWith(prefix))) {
    throw new ConnectError(
      `Stream name "${req.name}" uses a reserved prefix`,
      Code.InvalidArgument,
    );
  }

  let stream;
  try {
    stream = streamRegistry.createStream(req.name, req.selfEcho);
  } catch {
    throw new ConnectError(`Stream name "${req.name}" already exists`, Code.AlreadyExists);
  }

  // Anchor the room with the operator principal: `rw` so a later OperatorPublish
  // (T5) can write, `detach` so the server-side principal holds the room open and
  // shows in the roster without being async-pushed messages.
  streamRegistry.subscribe(stream.id, OPERATOR_PRINCIPAL, "rw", "detach", false);

  return create(grackle.OperatorCreateStreamResponseSchema, { streamId: stream.id });
}

/**
 * Attach a task's latest live session to a stream (operator-driven). The
 * attachment is ephemeral in T1 — it lives with the resolved session; durable,
 * re-applied task-keyed intent lands in T2 (#1310). Fails with FailedPrecondition
 * when the task has no live session to attach.
 */
export async function operatorAttachTask(
  req: grackle.OperatorAttachTaskRequest,
): Promise<grackle.OperatorAttachTaskResponse> {
  if (!req.taskId) {
    throw new ConnectError("task_id is required", Code.InvalidArgument);
  }
  if (!req.streamId) {
    throw new ConnectError("stream_id is required", Code.InvalidArgument);
  }

  const stream = streamRegistry.getStream(req.streamId);
  if (!stream) {
    throw new ConnectError(`Stream not found: ${req.streamId}`, Code.NotFound);
  }
  if (!isOperatorRoom(stream)) {
    throw new ConnectError(
      `Stream ${req.streamId} is not an operator-owned room`,
      Code.FailedPrecondition,
    );
  }

  // The operator principal holds `rw`, so any requested grant ("r"/"w"/"rw") is
  // trivially a subset; we only validate the permission/delivery values here.
  const permission = req.permission || "rw";
  const deliveryMode = req.deliveryMode || "async";
  validateSubscriptionParams(permission, deliveryMode);

  const sessionId = resolveLiveSessionForTask(req.taskId);
  if (!sessionId) {
    throw new ConnectError(
      `Task ${req.taskId} has no live session to attach (durable attach lands in T2)`,
      Code.FailedPrecondition,
    );
  }

  const sub = streamRegistry.subscribe(
    req.streamId,
    sessionId,
    permission as "r" | "w" | "rw",
    deliveryMode as "sync" | "async" | "detach",
    false,
  );

  if (deliveryMode === "async") {
    pipeDelivery.ensureAsyncDeliveryListener(sessionId);
  }

  return create(grackle.OperatorAttachTaskResponseSchema, { sessionId, fd: sub.fd });
}

/**
 * Detach a task's latest live session from a stream (operator-driven). The
 * operator anchor keeps the room alive after the agent leaves. Only operates on
 * operator-owned rooms. Idempotent: returns `detached=false` when the room is
 * already gone, the task has no live session, or it has no matching subscription
 * on the stream.
 */
export async function operatorDetachTask(
  req: grackle.OperatorDetachTaskRequest,
): Promise<grackle.OperatorDetachTaskResponse> {
  if (!req.taskId) {
    throw new ConnectError("task_id is required", Code.InvalidArgument);
  }
  if (!req.streamId) {
    throw new ConnectError("stream_id is required", Code.InvalidArgument);
  }

  const stream = streamRegistry.getStream(req.streamId);
  if (!stream) {
    // Room already gone — nothing to detach.
    return create(grackle.OperatorDetachTaskResponseSchema, { detached: false });
  }
  if (!isOperatorRoom(stream)) {
    throw new ConnectError(
      `Stream ${req.streamId} is not an operator-owned room`,
      Code.FailedPrecondition,
    );
  }

  const sessionId = resolveLiveSessionForTask(req.taskId);
  if (!sessionId) {
    return create(grackle.OperatorDetachTaskResponseSchema, { detached: false });
  }

  const sub = streamRegistry
    .getSubscriptionsForSession(sessionId)
    .find((s) => s.streamId === req.streamId);
  if (!sub) {
    return create(grackle.OperatorDetachTaskResponseSchema, { detached: false });
  }

  streamRegistry.unsubscribe(sub.id);
  pipeDelivery.cleanupAsyncListenerIfEmpty(sessionId);

  return create(grackle.OperatorDetachTaskResponseSchema, { detached: true });
}

/**
 * List the rooms a task's latest live session is attached to (operator-driven).
 * Reserved plumbing streams are excluded. In T1 this reflects the live session's
 * current subscriptions; durable task-keyed intent (including not-yet-started
 * tasks) lands in T2 (#1310).
 */
export async function listTaskAttachments(
  req: grackle.ListTaskAttachmentsRequest,
): Promise<grackle.ListTaskAttachmentsResponse> {
  if (!req.taskId) {
    throw new ConnectError("task_id is required", Code.InvalidArgument);
  }

  const sessionId = resolveLiveSessionForTask(req.taskId);
  if (!sessionId) {
    return create(grackle.ListTaskAttachmentsResponseSchema, { attachments: [] });
  }

  const attachments = streamRegistry
    .getSubscriptionsForSession(sessionId)
    .map((sub) => ({ sub, stream: streamRegistry.getStream(sub.streamId) }))
    .filter((entry) => entry.stream && !isReservedStreamName(entry.stream.name))
    .map((entry) =>
      create(grackle.TaskAttachmentSchema, {
        streamId: entry.sub.streamId,
        streamName: entry.stream!.name,
        sessionId,
        permission: entry.sub.permission,
        deliveryMode: entry.sub.deliveryMode,
      }),
    );

  return create(grackle.ListTaskAttachmentsResponseSchema, { attachments });
}

/**
 * Close an operator room — evict all subscribers (including the operator anchor)
 * and remove the stream. Only operator-owned rooms can be closed: reserved
 * plumbing streams and agent-owned rooms (no `operator:*` anchor) are rejected.
 */
export async function operatorCloseStream(
  req: grackle.OperatorCloseStreamRequest,
): Promise<grackle.OperatorCloseStreamResponse> {
  if (!req.streamId) {
    throw new ConnectError("stream_id is required", Code.InvalidArgument);
  }

  const stream = streamRegistry.getStream(req.streamId);
  if (!stream) {
    throw new ConnectError(`Stream not found: ${req.streamId}`, Code.NotFound);
  }
  if (isReservedStreamName(stream.name)) {
    throw new ConnectError(
      `Stream "${stream.name}" is an internal plumbing stream and cannot be closed`,
      Code.InvalidArgument,
    );
  }
  if (!isOperatorRoom(stream)) {
    throw new ConnectError(
      `Stream ${req.streamId} is not an operator-owned room`,
      Code.FailedPrecondition,
    );
  }

  streamRegistry.deleteStream(req.streamId);

  return create(grackle.OperatorCloseStreamResponseSchema, { closed: true });
}

/** List sessions with optional filters. */
export async function listSessions(req: grackle.SessionFilter): Promise<grackle.SessionList> {
  const rows = sessionStore.listSessions(req.environmentId, req.status);
  return create(grackle.SessionListSchema, {
    sessions: rows.map(sessionRowToProto),
  });
}

/** Get a session by ID. */
export async function getSession(req: grackle.SessionId): Promise<grackle.Session> {
  const row = sessionStore.getSession(req.id);
  if (!row) {
    throw new ConnectError(`Session not found: ${req.id}`, Code.NotFound);
  }
  return sessionRowToProto(row);
}

/** Get all events recorded for a session. */
export async function getSessionEvents(req: grackle.SessionId): Promise<grackle.SessionEventList> {
  const session = sessionStore.getSession(req.id);
  if (!session) {
    throw new ConnectError(`Session not found: ${req.id}`, Code.NotFound);
  }
  if (!session.logPath) {
    return create(grackle.SessionEventListSchema, {
      sessionId: req.id,
      events: [],
    });
  }
  const entries = logWriter.readLog(session.logPath);
  return create(grackle.SessionEventListSchema, {
    sessionId: req.id,
    events: entries.map((e) =>
      create(grackle.SessionEventSchema, {
        sessionId: e.session_id,
        type: eventTypeToEnum(e.type),
        timestamp: e.timestamp,
        content: e.content,
        raw: e.raw || "",
        toolCallId: e.tool_call_id || "",
        diagnostic: e.diagnostic || false,
        turnId: e.turn_id || "",
        serverSeq: e.server_seq || "",
      }),
    ),
  });
}

/** Get all sessions for a task. */
export async function getTaskSessions(req: grackle.TaskId): Promise<grackle.SessionList> {
  if (!req.id) {
    throw new ConnectError("task id is required", Code.InvalidArgument);
  }
  const rows = sessionStore.listSessionsForTask(req.id);
  return create(grackle.SessionListSchema, {
    sessions: rows.map(sessionRowToProto),
  });
}

/** Stream session events as they occur. */
export async function* streamSession(req: grackle.SessionId): AsyncGenerator<grackle.SessionEvent> {
  const stream = streamHub.createStream(req.id);
  try {
    for await (const event of stream) {
      yield event;
    }
  } finally {
    stream.cancel();
  }
}

/** Stream all session events across all sessions. */
export async function* streamAll(): AsyncGenerator<grackle.SessionEvent> {
  const stream = streamHub.createGlobalStream();
  try {
    for await (const event of stream) {
      yield event;
    }
  } finally {
    stream.cancel();
  }
}

/** Stream domain events (replaces WebSocket event broadcasting). */
export async function* streamEvents(): AsyncGenerator<grackle.ServerEvent> {
  // Create the event stream FIRST so the domain-event subscription is registered
  // before draining pending escalations (otherwise drained events would be missed).
  const stream = createEventStream();

  // Drain pending escalations — emits domain events that flow through the stream.
  deliverPendingEscalations().catch((err) => {
    logger.error({ err }, "Failed to drain pending escalations on stream connect");
  });

  try {
    for await (const event of stream) {
      yield event;
    }
  } finally {
    stream.cancel();
  }
}
