import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import type { PipeMode } from "@grackle-ai/common";
import {
  DEFAULT_MCP_PORT,
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  type SessionStatus,
  LOGS_DIR,
  eventTypeToEnum,
} from "@grackle-ai/common";
import { envRegistry, sessionStore, taskStore, personaStore, settingsStore, grackleHome } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { join } from "node:path";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import * as adapterManager from "./adapter-manager.js";
import * as streamHub from "./stream-hub.js";
import * as tokenPush from "./token-push.js";
import { parseAdapterConfig } from "./adapter-config.js";
import { emit } from "./event-bus.js";
import { processEventStream } from "./event-processor.js";
import { recoverSuspendedSessions } from "./session-recovery.js";
import { logger } from "./logger.js";
import { reanimateAgent } from "./reanimate-agent.js";
import * as streamRegistry from "./stream-registry.js";
import * as pipeDelivery from "./pipe-delivery.js";
import * as logWriter from "./log-writer.js";
import { createScopedToken, loadOrCreateApiKey } from "@grackle-ai/auth";
import { resolvePersona, SystemPromptBuilder } from "@grackle-ai/prompt";
import { toPersonaResolveInput } from "./persona-mapper.js";
import { sendInputToSession } from "./signals/signal-delivery.js";
import { createEventStream } from "./event-hub.js";
import { sessionRowToProto } from "./grpc-proto-converters.js";
import { validatePipeInputs, toDialableHost, killSessionAndCleanup } from "./grpc-shared.js";
import { personaMcpServersToJson } from "./grpc-mcp-config.js";
import { getTraceId } from "./trace-context.js";

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
    // Auto-provision: attempt to reconnect/provision a disconnected environment
    const adapter = adapterManager.getAdapter(env.adapterType);
    if (!adapter) {
      throw new ConnectError(`No adapter for type: ${env.adapterType}`, Code.FailedPrecondition);
    }

    logger.info({ environmentId: req.environmentId }, "Auto-provisioning environment for SpawnAgent");
    envRegistry.updateEnvironmentStatus(req.environmentId, "connecting");
    emit("environment.changed", {});

    const config = parseAdapterConfig(env.adapterConfig);
    config.defaultRuntime = env.defaultRuntime;
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
      await tokenPush.pushToEnv(req.environmentId);
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
      req.personaId,
      undefined,
      undefined,
      settingsStore.getSetting("default_persona_id") || undefined,
      (id) => toPersonaResolveInput(personaStore.getPersona(id)),
    );
  } catch (err) {
    throw new ConnectError((err as Error).message, Code.FailedPrecondition);
  }

  const sessionId = uuid();
  const { runtime, model, systemPrompt } = resolved;
  const maxTurns = req.maxTurns || resolved.maxTurns;
  const logPath = join(grackleHome, LOGS_DIR, sessionId);

  const builderPrompt = new SystemPromptBuilder({
    personaPrompt: systemPrompt,
  }).build();
  const systemContext = req.systemContext
    ? builderPrompt + "\n\n" + req.systemContext
    : builderPrompt;

  // Validate pipe inputs before creating the session or spawning the child
  validatePipeInputs(req.pipe, req.parentSessionId);
  const pipeMode = req.pipe as PipeMode;

  sessionStore.createSession(
    sessionId,
    req.environmentId,
    runtime,
    req.prompt,
    model,
    logPath,
    "",                      // taskId
    resolved.personaId,      // personaId
    req.parentSessionId || "",  // parentSessionId
    pipeMode || "",          // pipeMode
  );

  const mcpServersJson = personaMcpServersToJson(resolved.mcpServers, resolved.personaId);

  const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const mcpDialHost = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
  const mcpUrl = `http://${mcpDialHost}:${mcpPort}/mcp`;
  const mcpToken = createScopedToken(
    { sub: sessionId, pid: "", per: resolved.personaId, sid: sessionId },
    loadOrCreateApiKey(grackleHome),
  );

  const powerlineReq = create(powerline.SpawnRequestSchema, {
    sessionId,
    runtime,
    prompt: req.prompt,
    model,
    maxTurns,
    branch: req.branch,
    workingDirectory: req.branch
      ? (req.workingDirectory.trim() || process.env.GRACKLE_WORKING_DIRECTORY || process.env.GRACKLE_WORKTREE_BASE || "/workspace")
      : "",
    systemContext,
    mcpServersJson,
    mcpUrl,
    mcpToken,
    scriptContent: resolved.type === "script" ? resolved.script : "",
    pipe: req.pipe,
  });

  // Create lifecycle stream — every session gets one. The spawner holds
  // a lifecycle fd; when it's closed, the session auto-stops.
  const lifecycleStream = streamRegistry.createStream(`lifecycle:${sessionId}`);
  const spawnerId = req.parentSessionId || "__server__";
  streamRegistry.subscribe(lifecycleStream.id, spawnerId, "rw", "detach", true);
  streamRegistry.subscribe(lifecycleStream.id, sessionId, "rw", "detach", false);

  // Set up IPC pipe stream (optional, on top of lifecycle stream)
  let pipeFd = 0;
  if (pipeMode && pipeMode !== "detach" && req.parentSessionId) {
    const ipcStream = streamRegistry.createStream(`pipe:${sessionId}`);
    const parentSub = streamRegistry.subscribe(
      ipcStream.id, req.parentSessionId, "rw",
      pipeMode === "sync" ? "sync" : "async",
      true,  // parent opened this via spawn
    );
    streamRegistry.subscribe(
      ipcStream.id, sessionId, "rw", "async",
      false, // child inherits
    );
    pipeFd = parentSub.fd;

    if (pipeMode === "async") {
      pipeDelivery.ensureAsyncDeliveryListener(req.parentSessionId);  // parent receives child messages
      pipeDelivery.ensureAsyncDeliveryListener(sessionId);             // child receives parent messages
    }
  }

  // Push fresh credentials before spawning (best-effort).
  // For local envs, skip file tokens — the PowerLine is on the same machine.
  await tokenPush.refreshTokensForTask(req.environmentId, runtime,
    env.adapterType === "local" ? { excludeFileTokens: true } : undefined);

  processEventStream(conn.client.spawn(powerlineReq), {
    sessionId,
    logPath,
    systemContext,
    prompt: req.prompt,
    traceId: getTraceId(),
  });

  const row = sessionStore.getSession(sessionId);
  const proto = sessionRowToProto(row!);
  proto.pipeFd = pipeFd;
  return proto;
}

/** Resume a previously suspended agent session. */
export async function resumeAgent(req: grackle.ResumeRequest): Promise<grackle.Session> {
  const row = reanimateAgent(req.sessionId);
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
    throw new ConnectError(`Environment ${session.environmentId} not connected`, Code.FailedPrecondition);
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
    logWriter.writeEvent(session.logPath, userInputEvent);
  }
  streamHub.publish(userInputEvent);

  await conn.client.sendInput(
    create(powerline.InputMessageSchema, {
      sessionId: req.sessionId,
      text: req.text,
    }),
  );

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
      const delivered = await sendInputToSession(session.id, session.environmentId, message, "sigterm");
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
        costUsd: session.costUsd,
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
      const usage = taskIds.length > 0
        ? sessionStore.aggregateUsage({ taskIds })
        : { inputTokens: 0, outputTokens: 0, costUsd: 0, sessionCount: 0 };
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
export async function waitForPipe(req: grackle.WaitForPipeRequest): Promise<grackle.WaitForPipeResponse> {
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

  // Collect child sessions (inherited subscriptions, not the caller's)
  const childSubs: Array<{ sessionId: string; subId: string }> = [];
  if (stream) {
    for (const s of stream.subscriptions.values()) {
      if (s.sessionId !== req.sessionId) {
        childSubs.push({ sessionId: s.sessionId, subId: s.id });
      }
    }
  }

  // Unsubscribe the caller
  streamRegistry.unsubscribe(sub.id);

  // Also unsubscribe children — when their last subscription is removed,
  // the lifecycle manager's orphan callback auto-stops them.
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
  const stream = createEventStream();
  try {
    for await (const event of stream) {
      yield event;
    }
  } finally {
    stream.cancel();
  }
}
