import { create } from "@bufbuild/protobuf";
import { grackle, PreconditionError, ValidationError } from "@grackle-ai/common";
import type { PipeMode } from "@grackle-ai/common";
import {
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  type SessionStatus,
  LOGS_DIR,
} from "@grackle-ai/common";
import { getDatabaseStores, grackleHome } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { join } from "node:path";
import { adapterManager } from "@grackle-ai/core";
import { tokenPush } from "@grackle-ai/core";
import { logger } from "@grackle-ai/core";
import { reanimateAgent } from "@grackle-ai/core";
import { createScopedToken, loadOrCreateApiKey } from "@grackle-ai/auth";
import { resolvePersona, SystemPromptBuilder } from "@grackle-ai/prompt";
import { toPersonaResolveInput } from "@grackle-ai/core";
import { sendInputToSession } from "@grackle-ai/core";
import { sessionRowToProto } from "./grpc-proto-converters.js";
import { validatePipeInputs, killSessionAndCleanup } from "./grpc-shared.js";
import { requireEnvironment, requireField, requireSession } from "./require-helpers.js";
import { buildCreateSessionParams } from "./spawn-request.js";
import { buildMcpUrl, executeSpawnTail, ensureSpawnConnection } from "./spawn-orchestration.js";
import {
  resolveSpawnSpec,
  personaToLayer,
  spawnRequestToLayer,
  hostDefaults,
} from "@grackle-ai/core";
import { buildMcpServersJson, toPersonaModel } from "@grackle-ai/core";
import { getTraceId } from "@grackle-ai/core";
import { publishToStdin } from "@grackle-ai/core";
import { taskService } from "@grackle-ai/core";

/** Spawn a new agent session in the given environment. */
export async function spawnAgent(req: grackle.SpawnRequest): Promise<grackle.Session> {
  const { sessionStore, taskStore, personaStore, settingsStore } = getDatabaseStores();
  const env = requireEnvironment(req.environmentId);
  const conn = await ensureSpawnConnection(env);

  // Resolve persona via cascade (request → app default)
  let resolved: ReturnType<typeof resolvePersona>;
  try {
    resolved = resolvePersona(
      req.config?.personaId ?? "",
      undefined,
      undefined,
      settingsStore.getSetting("default_persona_id") || undefined,
      (id) => {
        const row = personaStore.getPersona(id);
        return row ? toPersonaResolveInput(toPersonaModel(row)) : undefined;
      },
    );
  } catch (err) {
    throw new PreconditionError((err as Error).message);
  }

  const sessionId = uuid();
  const cfg = req.config;
  const parentSessionId = cfg?.parentSessionId ?? "";

  // Unified spawn-config cascade (#1427): host → persona → spawnOverride. No
  // workspace/task/agent layers here — direct spawnAgent has no task context.
  const spec = resolveSpawnSpec({
    host: hostDefaults(),
    persona: personaToLayer(resolved),
    spawnOverride: spawnRequestToLayer({
      provider: req.provider,
      modelId: req.model?.id,
      configMaxTurns: cfg?.maxTurns,
      configWorkingDirectory: cfg?.workingDirectory,
      configUseWorktrees: cfg?.useWorktrees,
    }),
  });
  const { runtime, model, maxTurns } = spec;

  // Supply credentials on demand for this runtime, just before spawn (AHP HR6).
  // For local envs, skip file tokens — the PowerLine is on the same machine.
  // Runs a fail-fast pre-flight (#1316): a required-but-missing/expired credential
  // throws here, before any session row is created below.
  await tokenPush.authenticateForRuntime(
    req.environmentId,
    runtime,
    env.adapterType === "local" ? { excludeFileTokens: true } : undefined,
  );

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

  const mcpServersJson =
    resolved.mcpServers.length > 0 ? buildMcpServersJson(resolved.mcpServers) : "";

  const mcpUrl = buildMcpUrl();
  // Resolve workspace scope for the token: prefer explicit workspaceId, then inherit from the
  // parent session's task (for piped child sessions spawned from a task-based session).
  let resolvedWorkspaceId = cfg?.workspaceId || "";
  // #1418: agent_id can come from two places — the spawn request's own
  // `cfg.taskId` (when spawning a session against a known agent-owned task)
  // or the parent session's task (when piping a child session under a
  // task-based parent). Both paths produce the same agent attribution.
  let resolvedAgentId: string | undefined;
  if (cfg?.taskId) {
    const reqTask = taskStore.getTask(cfg.taskId);
    if (!resolvedWorkspaceId) {
      resolvedWorkspaceId = reqTask?.workspaceId || "";
    }
    resolvedAgentId = reqTask?.agentId || undefined;
  }
  if (!resolvedAgentId && parentSessionId) {
    const parentSession = sessionStore.getSession(parentSessionId);
    if (parentSession?.taskId) {
      const parentTask = taskStore.getTask(parentSession.taskId);
      if (!resolvedWorkspaceId) {
        resolvedWorkspaceId = parentTask?.workspaceId || "";
      }
      resolvedAgentId = parentTask?.agentId || undefined;
    }
  }
  const mcpToken = createScopedToken(
    {
      sub: sessionId,
      pid: resolvedWorkspaceId,
      per: resolved.personaId,
      sid: sessionId,
      agt: resolvedAgentId,
    },
    loadOrCreateApiKey(grackleHome),
  );

  // `workingDirectory` is only meaningful when the session pins to a branch
  // — the workflow rule "no branch → no working dir" stays at the call site;
  // the cascade itself is handled by resolveSpawnSpec above.
  const workingDirectory = cfg?.branch ? spec.workingDirectory : "";
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

  const { stream } = conn.transport.createSession(createParams);

  logger.info({ sessionId, environmentId: req.environmentId }, "Session spawned");

  return executeSpawnTail({
    sessionId,
    parentSessionId,
    pipeMode,
    transportStream: stream,
    eventContext: {
      sessionId,
      logPath,
      systemContext,
      prompt: req.prompt,
      traceId: getTraceId(),
    },
  });
}

/** Resume a previously suspended agent session. */
export async function resumeAgent(req: grackle.ResumeRequest): Promise<grackle.Session> {
  const row = reanimateAgent(req.sessionId);
  logger.info({ sessionId: req.sessionId }, "Session resumed");
  return sessionRowToProto(row);
}

/** Send text input to a running session. */
export async function sendInput(req: grackle.InputMessage): Promise<grackle.Empty> {
  const session = requireSession(req.sessionId);
  if (TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
    throw new PreconditionError(`Session ${req.sessionId} has ended (status: ${session.status})`);
  }

  const conn = adapterManager.getConnection(session.environmentId);
  if (!conn) {
    throw new PreconditionError(`Environment ${session.environmentId} not connected`);
  }

  logger.debug({ sessionId: req.sessionId }, "User input received");

  // Route through stdin stream — the async listener delivers to PowerLine.
  // The runtime emits a turn_started event with the user's text (AHP HR2),
  // which the UI renders as the user message — no separate USER_INPUT event
  // needed here.
  publishToStdin(req.sessionId, req.text);

  return create(grackle.EmptySchema, {});
}

/** Kill (or gracefully stop) an agent session. */
export async function killAgent(req: grackle.KillAgentRequest): Promise<grackle.Empty> {
  const { sessionStore } = getDatabaseStores();
  const session = requireSession(req.id);

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
  const { sessionStore, taskStore } = getDatabaseStores();
  requireField(req.id, "id");
  switch (req.scope) {
    case "session": {
      const session = requireSession(req.id);
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
      const descendants = taskService.getDescendants(req.id);
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
      throw new ValidationError(`Invalid usage scope: ${req.scope}`);
  }
}

// ─── Re-exports from extracted handler modules ──────────────────────────────

export { waitForPipe, writeToFd, closeFd, getSessionFds } from "./pipe-handlers.js";
export { createStream, attachStream, listStreams } from "./global-stream-handlers.js";
export {
  operatorCreateStream,
  operatorAttachTask,
  operatorDetachTask,
  listTaskAttachments,
  operatorCloseStream,
} from "./operator-stream-handlers.js";
export {
  listSessions,
  getSession,
  getSessionEvents,
  getTaskSessions,
  streamSession,
  streamAll,
  streamEvents,
} from "./session-query-handlers.js";
