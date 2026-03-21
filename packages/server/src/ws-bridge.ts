import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import * as envRegistry from "./env-registry.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import {
  type PowerLineConnection,
  reconnectOrProvision,
} from "@grackle-ai/adapter-sdk";
import * as streamHub from "./stream-hub.js";
import * as tokenBroker from "./token-broker.js";
import * as credentialProviders from "./credential-providers.js";
import * as workspaceStore from "./workspace-store.js";
import * as taskStore from "./task-store.js";
import * as findingStore from "./finding-store.js";
import * as personaStore from "./persona-store.js";
import { v4 as uuid } from "uuid";
import { join } from "node:path";
import {
  LOGS_DIR,
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  type SessionStatus,
  TASK_STATUS,
  DEFAULT_MCP_PORT,
  ROOT_TASK_ID,
  eventTypeToString,
} from "@grackle-ai/common";
import { resolvePersona } from "./resolve-persona.js";
import { fetchOrchestratorContext } from "./orchestrator-context.js";
import * as settingsStore from "./settings-store.js";
import { isAllowedSettingKey } from "./settings-store.js";
import { grackleHome } from "./paths.js";
import * as logWriter from "./log-writer.js";
import { safeParseJsonArray } from "./json-helpers.js";
import { logger } from "./logger.js";
import { SystemPromptBuilder, buildTaskPrompt } from "./system-prompt-builder.js";
import { slugify } from "./utils/slugify.js";
import { processEventStream } from "./event-processor.js";
import * as processorRegistry from "./processor-registry.js";
import { setWssInstance, envRowToWs } from "./ws-broadcast.js";
import { emit } from "./event-bus.js";
import { buildMcpServersJson, toDialableHost } from "./grpc-service.js";
import { createScopedToken } from "@grackle-ai/mcp";
import { loadOrCreateApiKey } from "./api-key.js";
import { reanimateAgent } from "./reanimate-agent.js";
import { ConnectError } from "@connectrpc/connect";
import { computeTaskStatus } from "./compute-task-status.js";
import { exec } from "./utils/exec.js";
import { formatGhError } from "./utils/format-gh-error.js";

const GH_CODESPACE_LIST_TIMEOUT_MS: number = 30_000;
const GH_CODESPACE_CREATE_TIMEOUT_MS: number = 300_000;
const GH_CODESPACE_LIST_LIMIT: number = 50;

const WS_PING_INTERVAL_MS: number = 30_000;
const WS_CLOSE_UNAUTHORIZED: number = 4001;

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
  id?: string;
}

/** Create a WebSocket server on top of an HTTP server that bridges JSON messages to gRPC operations. */
export function createWsBridge(
  httpServer: HttpServer,
  verifyApiKey: (token: string) => boolean,
  validateCookie?: (cookieHeader: string) => boolean,
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer });
  setWssInstance(wss);

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "/", "http://localhost");
    const token = url.searchParams.get("token") || "";
    const hasValidToken = token.length > 0 && verifyApiKey(token);
    const hasValidCookie = validateCookie
      ? validateCookie(req.headers.cookie || "")
      : false;

    if (!hasValidToken && !hasValidCookie) {
      ws.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
      return;
    }

    const subscriptions = new Map<string, { cancel(): void }>();

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    ws.on("message", async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage;
        await handleMessage(ws, msg, subscriptions);
      } catch (err) {
        sendWs(ws, { type: "error", payload: { message: String(err) } });
      }
    });

    ws.on("close", () => {
      for (const sub of subscriptions.values()) {
        sub.cancel();
      }
    });

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, WS_PING_INTERVAL_MS);

    ws.on("close", () => clearInterval(pingInterval));
  });

  return wss;
}


/** Safely parse an adapter config string, returning an empty object on failure. */
function safeParseAdapterConfig(
  raw: string,
  environmentId: string,
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    logger.warn(
      { environmentId, raw },
      "adapterConfig is not an object, using empty config",
    );
    return {};
  } catch (err) {
    logger.warn(
      { environmentId, raw, err },
      "Failed to parse adapterConfig, using empty config",
    );
    return {};
  }
}

/**
 * Auto-provisions and connects an environment if it is not already connected.
 * Sends provision progress events over the WebSocket and updates the environment
 * registry status. Returns the connection on success, or undefined on failure.
 */
async function autoProvisionEnvironment(
  ws: WebSocket,
  environmentId: string,
  env: envRegistry.EnvironmentRow,
  logContext: Record<string, string>,
): Promise<PowerLineConnection | undefined> {
  let conn = adapterManager.getConnection(environmentId);
  if (conn) {
    return conn;
  }

  const adapter = adapterManager.getAdapter(env.adapterType);
  if (!adapter) {
    sendWs(ws, {
      type: "error",
      payload: { message: `No adapter for type: ${env.adapterType}` },
    });
    return undefined;
  }

  logger.info(
    { environmentId, ...logContext },
    "Auto-provisioning environment",
  );
  envRegistry.updateEnvironmentStatus(environmentId, "connecting");
  emit("environment.changed", {});

  try {
    const config = safeParseAdapterConfig(env.adapterConfig, environmentId);
    config.defaultRuntime = env.defaultRuntime;
    const powerlineToken = env.powerlineToken || "";

    for await (const provEvent of reconnectOrProvision(
      environmentId,
      adapter,
      config,
      powerlineToken,
      !!env.bootstrapped,
    )) {
      logger.info(
        { environmentId, stage: provEvent.stage, ...logContext },
        "Auto-provision progress",
      );
      emit("environment.provision_progress", {
        environmentId,
        stage: provEvent.stage,
        message: provEvent.message,
        progress: provEvent.progress,
      });
    }

    conn = await adapter.connect(environmentId, config, powerlineToken);
    adapterManager.setConnection(environmentId, conn);
    // Push stored tokens to newly connected environment
    await tokenBroker.pushToEnv(environmentId);
    envRegistry.updateEnvironmentStatus(environmentId, "connected");
    envRegistry.markBootstrapped(environmentId);
    emit("environment.changed", {});
    logger.info({ environmentId, ...logContext }, "Auto-provision complete");
    emit("environment.provision_progress", {
      environmentId,
      stage: "ready",
      message: "Environment connected",
      progress: 1,
    });
    return conn;
  } catch (err) {
    logger.error(
      { environmentId, ...logContext, err },
      "Auto-provision failed",
    );
    envRegistry.updateEnvironmentStatus(environmentId, "error");
    emit("environment.changed", {});
    const errorMessage = err instanceof Error ? err.message : String(err);
    emit("environment.provision_progress", {
      environmentId,
      stage: "error",
      message: `Auto-provision failed: ${errorMessage}`,
      progress: 0,
    });
    sendWs(ws, {
      type: "error",
      payload: {
        message: `Failed to auto-connect environment ${environmentId}: ${errorMessage}`,
      },
    });
    return undefined;
  }
}

/**
 * Start a new agent session for a task. Handles environment lookup,
 * auto-provisioning, session creation, spawning, and completion wiring.
 *
 * Returns undefined on success (or if the failure was already reported
 * to the client via WS, e.g. provisioning errors), or an error message
 * string for failures that need the caller to surface to the client.
 */
export async function startTaskSession(
  ws: WebSocket | undefined,
  task: taskStore.TaskRow,
  options?: { personaId?: string; environmentId?: string; notes?: string },
): Promise<string | undefined> {
  const workspace = task.workspaceId ? workspaceStore.getWorkspace(task.workspaceId) : undefined;
  if (task.workspaceId && !workspace) {
    logger.warn(
      { taskId: task.id },
      "startTaskSession failed: workspace not found",
    );
    return `Workspace not found: ${task.workspaceId}`;
  }

  const environmentId = options?.environmentId || workspace?.environmentId || "";
  const env = envRegistry.getEnvironment(environmentId);
  if (!env) {
    logger.warn(
      { taskId: task.id, environmentId },
      "startTaskSession failed: environment not found",
    );
    return `Environment not found: ${environmentId}`;
  }

  let conn: PowerLineConnection | undefined;
  if (ws) {
    conn = await autoProvisionEnvironment(ws, environmentId, env, {
      taskId: task.id,
    });
  } else {
    conn = adapterManager.getConnection(environmentId) ?? undefined;
  }
  if (!conn) {
    return ws ? undefined : `Environment not connected: ${environmentId}`;
  }

  // Resolve persona via cascade (request → task → workspace → app default)
  let resolved;
  try {
    resolved = resolvePersona(options?.personaId || "", task.defaultPersonaId, workspace?.defaultPersonaId || "");
  } catch (err) {
    return (err as Error).message;
  }

  const sessionId = uuid();
  const { runtime, model, maxTurns, systemPrompt, persona: resolvedPersonaRow } = resolved;
  const logPath = join(grackleHome, LOGS_DIR, sessionId);

  const freshTask = taskStore.getTask(task.id) || task;
  // For the root/System task, use the user's chat message (passed as notes)
  // as the initial prompt instead of the task title "System".
  // For regular tasks, build the prompt from title + description.
  const taskPrompt = freshTask.id === ROOT_TASK_ID
    ? (options?.notes || "")
    : buildTaskPrompt(freshTask.title, freshTask.description, options?.notes);

  const orchestratorCtx = freshTask.canDecompose && freshTask.depth <= 1
    ? fetchOrchestratorContext(freshTask.workspaceId || "") : undefined;
  const systemContext = new SystemPromptBuilder({
    task: { title: freshTask.title, description: freshTask.description, notes: options?.notes || "" },
    taskId: freshTask.id, canDecompose: freshTask.canDecompose, personaPrompt: systemPrompt,
    taskDepth: freshTask.depth, ...orchestratorCtx,
    ...(orchestratorCtx && { triggerMode: "fresh" as const }),
  }).build();

  sessionStore.createSession(
    sessionId,
    environmentId,
    runtime,
    freshTask.title,
    model,
    logPath,
    freshTask.id,
    resolved.personaId,
  );

  emit("task.started", {
    taskId: freshTask.id,
    sessionId,
    workspaceId: freshTask.workspaceId || "",
  });

  // Re-push stored tokens + provider credentials (scoped to runtime) so they're fresh for this session.
  // For local envs, skip file tokens — the PowerLine is on the same machine.
  await tokenBroker.refreshTokensForTask(environmentId, runtime,
    env.adapterType === "local" ? { excludeFileTokens: true } : undefined);

  let mcpServersJson = "";
  try {
    const parsed: unknown = JSON.parse(resolvedPersonaRow.mcpServers || "[]");
    if (Array.isArray(parsed)) {
      const mcpServers = parsed as {
        name: string;
        command: string;
        args?: string[];
        tools?: string[];
      }[];
      if (mcpServers.length > 0) {
        mcpServersJson = buildMcpServersJson(mcpServers);
      }
    }
  } catch {
    logger.warn("Failed to parse persona.mcpServers JSON; ignoring");
  }

  // Build MCP broker URL + scoped token so runtimes can call the MCP server.
  const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const mcpDialHost = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
  const mcpUrl = `http://${mcpDialHost}:${mcpPort}/mcp`;
  const mcpToken = createScopedToken(
    { sub: freshTask.id, pid: freshTask.workspaceId || "", per: resolved.personaId, sid: sessionId },
    loadOrCreateApiKey(),
  );

  const useWorktrees = workspace?.useWorktrees ?? false;

  const powerlineReq = create(powerline.SpawnRequestSchema, {
    sessionId,
    runtime,
    prompt: taskPrompt,
    model,
    maxTurns,
    branch: freshTask.branch,
    worktreeBasePath: freshTask.branch
      ? (workspace?.worktreeBasePath || process.env.GRACKLE_WORKTREE_BASE || "/workspace")
      : "",
    useWorktrees,
    systemContext,
    workspaceId: freshTask.workspaceId ?? undefined,
    taskId: freshTask.id,
    mcpServersJson,
    mcpUrl,
    mcpToken,
  });

  processEventStream(conn.client.spawn(powerlineReq), {
    sessionId,
    logPath,
    workspaceId: freshTask.workspaceId ?? undefined,
    taskId: freshTask.id,
    systemContext,
    prompt: taskPrompt,
  });

  return undefined;
}

async function handleMessage(
  ws: WebSocket,
  msg: WsMessage,
  subscriptions: Map<string, { cancel(): void }>,
): Promise<void> {
  switch (msg.type) {
    case "list_environments": {
      const rows = envRegistry.listEnvironments();
      sendWs(ws, {
        type: "environments",
        payload: { environments: rows.map(envRowToWs) },
      });
      break;
    }

    case "list_sessions": {
      const environmentId = (msg.payload?.environmentId as string) || "";
      const status = (msg.payload?.status as string) || "";
      const rows = sessionStore.listSessions(environmentId, status);
      sendWs(ws, {
        type: "sessions",
        payload: {
          sessions: rows.map((r) => ({
            id: r.id,
            environmentId: r.environmentId,
            runtime: r.runtime,
            status: r.status,
            prompt: r.prompt,
            startedAt: r.startedAt,
            personaId: r.personaId,
          })),
        },
      });
      break;
    }

    case "get_session_events": {
      const sessionId = msg.payload?.sessionId as string;
      if (!sessionId) {
        return;
      }

      const session = sessionStore.getSession(sessionId);
      if (!session?.logPath) {
        return;
      }

      const entries = logWriter.readLog(session.logPath);
      const events = entries.map((e) => ({
        sessionId: e.session_id,
        eventType: e.type,
        timestamp: e.timestamp,
        content: e.content,
        raw: e.raw || undefined,
      }));

      sendWs(ws, { type: "session_events", payload: { sessionId, events } });
      break;
    }

    case "subscribe": {
      const sessionId = msg.payload?.sessionId as string;
      if (!sessionId) {
        return;
      }

      // Cancel any existing subscription for this session
      const subKey = `session:${sessionId}`;
      const existing = subscriptions.get(subKey);
      if (existing) {
        subscriptions.delete(subKey);
        existing.cancel();
      }

      const stream = streamHub.createStream(sessionId);
      subscriptions.set(subKey, stream);

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (async () => {
        for await (const event of stream) {
          sendWs(ws, {
            type: "session_event",
            payload: {
              sessionId: event.sessionId,
              eventType: eventTypeToString(event.type),
              timestamp: event.timestamp,
              content: event.content,
              raw: event.raw || undefined,
            },
          });
        }
      })();
      break;
    }

    case "subscribe_all": {
      // Cancel any existing global subscription
      const existingGlobal = subscriptions.get("global");
      if (existingGlobal) {
        subscriptions.delete("global");
        existingGlobal.cancel();
      }

      const stream = streamHub.createGlobalStream();
      subscriptions.set("global", stream);

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (async () => {
        for await (const event of stream) {
          sendWs(ws, {
            type: "session_event",
            payload: {
              sessionId: event.sessionId,
              eventType: eventTypeToString(event.type),
              timestamp: event.timestamp,
              content: event.content,
              raw: event.raw || undefined,
            },
          });
        }
      })();
      break;
    }

    case "spawn": {
      const environmentId = msg.payload?.environmentId as string;
      const prompt = msg.payload?.prompt as string;
      const branch = (msg.payload?.branch as string) || "";
      const systemContext = (msg.payload?.systemContext as string) || "";
      const spawnPersonaId = (msg.payload?.personaId as string) || "";

      if (!environmentId || !prompt) {
        sendWs(ws, {
          type: "error",
          payload: { message: "environmentId and prompt required" },
        });
        return;
      }

      // Resolve persona via cascade (request → app default)
      let resolved;
      try {
        resolved = resolvePersona(spawnPersonaId);
      } catch (err) {
        sendWs(ws, { type: "error", payload: { message: (err as Error).message } });
        return;
      }

      const env = envRegistry.getEnvironment(environmentId);
      if (!env) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Environment not found: ${environmentId}` },
        });
        return;
      }

      // Auto-provision the environment if not already connected
      const conn = await autoProvisionEnvironment(ws, environmentId, env, {});
      if (!conn) {
        return;
      }

      const sessionId = uuid();
      const { runtime: sessionRuntime, model: sessionModel, maxTurns, systemPrompt: spawnSystemPrompt } = resolved;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      const builderPrompt = new SystemPromptBuilder({
        personaPrompt: spawnSystemPrompt,
      }).build();
      const finalSystemContext = systemContext
        ? builderPrompt + "\n\n" + systemContext
        : builderPrompt;

      sessionStore.createSession(
        sessionId,
        environmentId,
        sessionRuntime,
        prompt,
        sessionModel,
        logPath,
      );

      sendWs(ws, { type: "spawned", payload: { sessionId } });

      const powerlineReq = create(powerline.SpawnRequestSchema, {
        sessionId,
        runtime: sessionRuntime,
        prompt,
        model: sessionModel,
        maxTurns,
        branch,
        worktreeBasePath: branch
          ? ((typeof msg.payload?.worktreeBasePath === "string" ? msg.payload.worktreeBasePath.trim() : "") || process.env.GRACKLE_WORKTREE_BASE || "/workspace")
          : "",
        systemContext: finalSystemContext,
      });

      processEventStream(conn.client.spawn(powerlineReq), {
        sessionId,
        logPath,
        systemContext: finalSystemContext,
        prompt,
        onError: (err) => {
          sendWs(ws, {
            type: "session_event",
            payload: {
              sessionId,
              eventType: "error",
              timestamp: new Date().toISOString(),
              content: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          });
        },
      });
      break;
    }

    case "send_input": {
      const sessionId = msg.payload?.sessionId as string;
      const text = msg.payload?.text as string;
      if (!sessionId || !text) {
        sendWs(ws, {
          type: "error",
          payload: { message: "sessionId and text required" },
        });
        return;
      }

      const session = sessionStore.getSession(sessionId);
      if (!session) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Session not found: ${sessionId}` },
        });
        return;
      }

      if (TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
        sendWs(ws, {
          type: "error",
          payload: {
            message: `Session ${sessionId} has ended (status: ${session.status})`,
          },
        });
        return;
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (!conn) {
        sendWs(ws, {
          type: "error",
          payload: {
            message: `Environment ${session.environmentId} is not connected`,
          },
        });
        return;
      }

      // Record the user's input as a session event before forwarding to the agent
      const userInputEvent = create(grackle.SessionEventSchema, {
        sessionId,
        type: grackle.EventType.USER_INPUT,
        timestamp: new Date().toISOString(),
        content: text,
      });
      if (session.logPath) {
        logWriter.writeEvent(session.logPath, userInputEvent);
      }
      streamHub.publish(userInputEvent);

      try {
        await conn.client.sendInput(
          create(powerline.InputMessageSchema, { sessionId, text }),
        );
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        sendWs(ws, {
          type: "error",
          payload: { message: `Failed to send input: ${errMessage}` },
        });
      }
      break;
    }

    case "kill": {
      const sessionId = msg.payload?.sessionId as string;
      if (!sessionId) {
        return;
      }

      const session = sessionStore.getSession(sessionId);
      if (!session) {
        return;
      }

      const conn = adapterManager.getConnection(session.environmentId);
      if (conn) {
        try {
          await conn.client.kill(
            create(powerline.SessionIdSchema, { id: sessionId }),
          );
        } catch (err) {
          logger.warn({ sessionId, err }, "PowerLine kill failed — marking session interrupted anyway");
        }
      }
      sessionStore.updateSession(sessionId, SESSION_STATUS.INTERRUPTED);
      streamHub.publish(
        create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: SESSION_STATUS.INTERRUPTED,
          raw: "",
        }),
      );

      // Broadcast task_updated so frontend re-fetches computed status
      if (session.taskId) {
        const task = taskStore.getTask(session.taskId);
        if (task) {
          emit("task.updated", { taskId: task.id, workspaceId: task.workspaceId || "" });
        }
      }
      break;
    }

    case "stop_task": {
      const taskId = msg.payload?.taskId as string;
      if (!taskId) return;

      // Kill all active sessions for this task (server-authoritative lookup)
      const activeSessions = sessionStore.getActiveSessionsForTask(taskId);
      for (const session of activeSessions) {
        const conn = adapterManager.getConnection(session.environmentId);
        if (conn) {
          try {
            await conn.client.kill(
              create(powerline.SessionIdSchema, { id: session.id }),
            );
          } catch (err) {
            logger.warn({ sessionId: session.id, err }, "PowerLine kill failed — marking session interrupted anyway");
          }
        }
        sessionStore.updateSession(session.id, SESSION_STATUS.INTERRUPTED);
        streamHub.publish(
          create(grackle.SessionEventSchema, {
            sessionId: session.id,
            type: grackle.EventType.STATUS,
            timestamp: new Date().toISOString(),
            content: SESSION_STATUS.INTERRUPTED,
            raw: "",
          }),
        );
      }

      // Mark task complete (same as "complete_task" handler)
      taskStore.markTaskComplete(taskId, TASK_STATUS.COMPLETE);
      const stoppedTask = taskStore.getTask(taskId);
      const unblocked = stoppedTask?.workspaceId ? taskStore.checkAndUnblock(stoppedTask.workspaceId) : [];
      sendWs(ws, {
        type: "task_completed",
        payload: {
          taskId,
          unblockedTaskIds: unblocked.map((t) => t.id),
        },
      });
      if (stoppedTask) {
        emit("task.completed", { taskId, workspaceId: stoppedTask.workspaceId || "" });
      }
      break;
    }

    case "resume_agent": {
      const resumeSessionId = msg.payload?.sessionId as string;
      if (!resumeSessionId) {
        sendWs(ws, { type: "error", payload: { message: "sessionId required" } });
        return;
      }
      try {
        reanimateAgent(resumeSessionId);
        sendWs(ws, { type: "agent_resumed", payload: { sessionId: resumeSessionId } });
      } catch (err) {
        const message = err instanceof ConnectError ? err.message : String(err);
        sendWs(ws, { type: "error", payload: { message } });
      }
      break;
    }

    // ─── Workspaces ────────────────────────────────────────

    case "list_workspaces": {
      const filterEnvironmentId = (msg.payload?.environmentId as string) || undefined;
      const rows = workspaceStore.listWorkspaces(filterEnvironmentId);
      sendWs(ws, {
        type: "workspaces",
        payload: {
          workspaces: rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            repoUrl: r.repoUrl,
            environmentId: r.environmentId,
            defaultPersonaId: r.defaultPersonaId,
            status: r.status,
            useWorktrees: r.useWorktrees,
            worktreeBasePath: r.worktreeBasePath,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
        },
      });
      break;
    }

    case "create_workspace": {
      const name = msg.payload?.name as string;
      if (!name) {
        sendWs(ws, { type: "error", payload: { message: "name required" } });
        return;
      }
      const createEnvironmentId = (msg.payload?.environmentId as string) || "";
      if (!createEnvironmentId) {
        sendWs(ws, { type: "error", payload: { message: "environmentId required" } });
        return;
      }
      if (!envRegistry.getEnvironment(createEnvironmentId)) {
        sendWs(ws, { type: "error", payload: { message: `Environment not found: ${createEnvironmentId}` } });
        return;
      }
      const baseWorkspaceId = slugify(name) || uuid().slice(0, 8);
      let id = baseWorkspaceId;
      for (
        let attempt = 0;
        attempt < 10 && workspaceStore.getWorkspace(id);
        attempt++
      ) {
        id = `${baseWorkspaceId}-${uuid().slice(0, 4)}`;
      }
      if (workspaceStore.getWorkspace(id)) {
        id = uuid();
      }
      // useWorktrees defaults to true when not specified
      const createUseWorktrees = (msg.payload?.useWorktrees as boolean | undefined) ?? true;
      workspaceStore.createWorkspace(
        id,
        name,
        (msg.payload?.description as string) || "",
        (msg.payload?.repoUrl as string) || "",
        createEnvironmentId,
        createUseWorktrees,
        typeof msg.payload?.worktreeBasePath === "string" ? msg.payload.worktreeBasePath.trim() : "",
        (msg.payload?.defaultPersonaId as string) || "",
      );
      emit("workspace.created", { workspaceId: id });
      break;
    }

    case "archive_workspace": {
      const workspaceId = msg.payload?.workspaceId as string;
      if (workspaceId) {
        workspaceStore.archiveWorkspace(workspaceId);
      }
      emit("workspace.archived", { workspaceId });
      break;
    }

    case "update_workspace": {
      const workspaceId = msg.payload?.workspaceId as string;
      if (!workspaceId) {
        sendWs(ws, { type: "error", payload: { message: "workspaceId required" } });
        return;
      }
      const existing = workspaceStore.getWorkspace(workspaceId);
      if (!existing) {
        sendWs(ws, { type: "error", payload: { message: `Workspace not found: ${workspaceId}` } });
        return;
      }
      const nameVal = typeof msg.payload?.name === "string" ? msg.payload.name : undefined;
      if (nameVal?.trim() === "") {
        sendWs(ws, { type: "error", payload: { message: "Workspace name cannot be empty" } });
        return;
      }
      const descVal = typeof msg.payload?.description === "string" ? msg.payload.description : undefined;
      const repoVal = typeof msg.payload?.repoUrl === "string" ? msg.payload.repoUrl : undefined;
      const envVal = typeof msg.payload?.environmentId === "string" ? msg.payload.environmentId : undefined;
      if (repoVal !== undefined && repoVal !== "" && !/^https?:\/\//i.test(repoVal)) {
        sendWs(ws, { type: "error", payload: { message: "Repository URL must use http or https scheme" } });
        return;
      }
      if (envVal !== undefined && !envRegistry.getEnvironment(envVal)) {
        sendWs(ws, { type: "error", payload: { message: `Environment not found: ${envVal}` } });
        return;
      }
      const worktreesVal = typeof msg.payload?.useWorktrees === "boolean" ? msg.payload.useWorktrees as boolean : undefined;
      const worktreeBasePathVal = typeof msg.payload?.worktreeBasePath === "string" ? msg.payload.worktreeBasePath as string : undefined;
      const defaultPersonaIdVal = typeof msg.payload?.defaultPersonaId === "string" ? msg.payload.defaultPersonaId as string : undefined;
      workspaceStore.updateWorkspace(workspaceId, {
        name: nameVal !== undefined ? nameVal.trim() : undefined,
        description: descVal,
        repoUrl: repoVal,
        environmentId: envVal,
        useWorktrees: worktreesVal,
        worktreeBasePath: worktreeBasePathVal,
        defaultPersonaId: defaultPersonaIdVal,
      });
      emit("workspace.updated", { workspaceId });
      break;
    }

    // ─── Personas ──────────────────────────────────────────

    case "list_personas": {
      const rows = personaStore.listPersonas();
      sendWs(ws, {
        type: "personas",
        payload: {
          personas: rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            systemPrompt: r.systemPrompt,
            toolConfig: r.toolConfig,
            runtime: r.runtime,
            model: r.model,
            maxTurns: r.maxTurns,
            mcpServers: r.mcpServers,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            type: r.type || "agent",
            script: r.script || "",
          })),
        },
      });
      break;
    }

    case "create_persona": {
      const personaName = msg.payload?.name as string;
      if (!personaName) {
        sendWs(ws, { type: "error", payload: { message: "name required" } });
        return;
      }
      const personaType = (msg.payload?.type as string) || "agent";
      if (personaType !== "agent" && personaType !== "script") {
        sendWs(ws, { type: "error", payload: { message: `Invalid persona type: "${personaType}". Must be "agent" or "script".` } });
        return;
      }
      const personaSystemPrompt = (msg.payload?.systemPrompt as string) || "";
      const personaScript = (msg.payload?.script as string) || "";
      if (personaType === "script") {
        if (!personaScript) {
          sendWs(ws, { type: "error", payload: { message: "script required for script personas" } });
          return;
        }
      } else {
        if (!personaSystemPrompt) {
          sendWs(ws, { type: "error", payload: { message: "systemPrompt required" } });
          return;
        }
      }
      let personaId = slugify(personaName) || uuid().slice(0, 8);
      const MAX_ID_RETRIES = 10;
      for (let i = 0; i < MAX_ID_RETRIES && personaStore.getPersona(personaId); i++) {
        personaId = `${slugify(personaName) || "persona"}-${uuid().slice(0, 4)}`;
      }
      personaStore.createPersona(
        personaId,
        personaName,
        (msg.payload?.description as string) || "",
        personaSystemPrompt,
        (msg.payload?.toolConfig as string) || "{}",
        (msg.payload?.runtime as string) || "",
        (msg.payload?.model as string) || "",
        (msg.payload?.maxTurns as number) || 0,
        (msg.payload?.mcpServers as string) || "[]",
        personaType,
        personaScript,
      );
      emit("persona.created", { personaId });
      break;
    }

    case "get_persona": {
      const getPersonaId = msg.payload?.personaId as string;
      if (!getPersonaId) return;
      const personaRow = personaStore.getPersona(getPersonaId);
      if (!personaRow) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Persona not found: ${getPersonaId}` },
        });
        return;
      }
      sendWs(ws, { type: "persona", payload: { persona: personaRow } });
      break;
    }

    case "update_persona": {
      const updatePersonaId = msg.payload?.personaId as string;
      if (!updatePersonaId) {
        sendWs(ws, {
          type: "error",
          payload: { message: "personaId required" },
        });
        return;
      }
      const existingPersona = personaStore.getPersona(updatePersonaId);
      if (!existingPersona) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Persona not found: ${updatePersonaId}` },
        });
        return;
      }
      personaStore.updatePersona(
        updatePersonaId,
        (msg.payload?.name as string | undefined) ?? existingPersona.name,
        (msg.payload?.description as string | undefined) ?? existingPersona.description,
        (msg.payload?.systemPrompt as string | undefined) ?? existingPersona.systemPrompt,
        (msg.payload?.toolConfig as string | undefined) ?? existingPersona.toolConfig,
        (msg.payload?.runtime as string | undefined) ?? existingPersona.runtime,
        (msg.payload?.model as string | undefined) ?? existingPersona.model,
        (msg.payload?.maxTurns as number | undefined) ?? existingPersona.maxTurns,
        (msg.payload?.mcpServers as string | undefined) ?? existingPersona.mcpServers,
        (msg.payload?.type as string | undefined) ?? existingPersona.type,
        (msg.payload?.script as string | undefined) ?? existingPersona.script,
      );
      emit("persona.updated", { personaId: updatePersonaId });
      break;
    }

    case "delete_persona": {
      const deletePersonaId = msg.payload?.personaId as string;
      if (!deletePersonaId) return;
      personaStore.deletePersona(deletePersonaId);
      emit("persona.deleted", { personaId: deletePersonaId });
      break;
    }

    // ─── Settings ────────────────────────────────────────────

    case "get_setting": {
      const key = msg.payload?.key;
      if (typeof key !== "string" || !key) return;
      if (!isAllowedSettingKey(key)) {
        sendWs(ws, { type: "error", payload: { message: `Setting key not allowed: ${key}` } });
        return;
      }
      const value = settingsStore.getSetting(key) ?? "";
      sendWs(ws, { type: "setting", payload: { key, value } });
      break;
    }

    case "set_setting": {
      const key = msg.payload?.key;
      const value = (msg.payload?.value as string) || "";
      if (typeof key !== "string" || !key) return;
      if (!isAllowedSettingKey(key)) {
        sendWs(ws, { type: "error", payload: { message: `Setting key not allowed: ${key}` } });
        return;
      }
      // Validate persona exists and has required fields when setting default_persona_id
      if (key === "default_persona_id" && value) {
        const persona = personaStore.getPersona(value);
        if (!persona) {
          sendWs(ws, { type: "error", payload: { message: `Persona not found: ${value}` } });
          return;
        }
        if (!persona.runtime || !persona.model) {
          sendWs(ws, { type: "error", payload: { message: `Persona "${persona.name}" must have runtime and model configured` } });
          return;
        }
      }
      settingsStore.setSetting(key, value);
      emit("setting.changed", { key, value });
      break;
    }

    // ─── Tasks ─────────────────────────────────────────────

    case "list_tasks": {
      const workspaceId = (msg.payload?.workspaceId as string) || undefined;
      const rows = taskStore.listTasks(workspaceId, {
        search: (msg.payload?.search as string) || undefined,
        status: (msg.payload?.status as string) || undefined,
      });
      const childIdsMap = taskStore.buildChildIdsMap(rows);

      // Batch-fetch sessions for all tasks and group by taskId
      const taskIds = rows.map((r) => r.id);
      const allSessions = sessionStore.listSessionsByTaskIds(taskIds);
      const sessionsByTask = new Map<string, typeof allSessions>();
      for (const s of allSessions) {
        const arr = sessionsByTask.get(s.taskId) ?? [];
        arr.push(s);
        sessionsByTask.set(s.taskId, arr);
      }

      sendWs(ws, {
        type: "tasks",
        payload: {
          workspaceId,
          tasks: rows.map((r) => {
            const taskSessions = sessionsByTask.get(r.id) ?? [];
            const computed = computeTaskStatus(r.status, taskSessions);
            return {
              id: r.id,
              workspaceId: r.workspaceId ?? undefined,
              title: r.title,
              description: r.description,
              status: computed.status,
              branch: r.branch,
              latestSessionId: computed.latestSessionId,
              dependsOn: safeParseJsonArray(r.dependsOn),
              sortOrder: r.sortOrder,
              createdAt: r.createdAt,
              parentTaskId: r.parentTaskId,
              depth: r.depth,
              childTaskIds: childIdsMap.get(r.id) ?? [],
              canDecompose: r.canDecompose,
              defaultPersonaId: r.defaultPersonaId,
            };
          }),
        },
      });
      break;
    }

    case "create_task": {
      const workspaceId = (msg.payload?.workspaceId as string) || undefined;
      const title = msg.payload?.title as string;
      const requestId =
        typeof msg.payload?.requestId === "string"
          ? msg.payload.requestId
          : "";
      if (!title) {
        sendWs(ws, {
          type: "create_task_error",
          payload: { message: "title required", requestId },
        });
        return;
      }
      let workspace: ReturnType<typeof workspaceStore.getWorkspace>;
      if (workspaceId) {
        workspace = workspaceStore.getWorkspace(workspaceId);
        if (!workspace) {
          sendWs(ws, {
            type: "create_task_error",
            payload: { message: `Workspace not found: ${workspaceId}`, requestId },
          });
          return;
        }
      }
      const parentTaskId = (msg.payload?.parentTaskId as string) || "";
      const rawCanDecompose = msg.payload?.canDecompose;
      // Default to false (no decomposition rights) unless explicitly granted.
      // Orchestrator/root processes that need fork() must opt in via canDecompose: true.
      const canDecompose =
        typeof rawCanDecompose === "boolean" ? rawCanDecompose : false;

      try {
        const id = uuid().slice(0, 8);
        taskStore.createTask(
          id,
          workspaceId,
          title,
          (msg.payload?.description as string | undefined) || "",
          (msg.payload?.dependsOn as string[] | undefined) || [],
          workspace ? slugify(workspace.name) : "",
          parentTaskId,
          canDecompose,
          (msg.payload?.defaultPersonaId as string) || "",
        );
        emit("task.created", { taskId: id, workspaceId, requestId });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to create task";
        sendWs(ws, {
          type: "create_task_error",
          payload: { message, requestId },
        });
      }
      break;
    }

    case "update_task": {
      const updateTaskId = msg.payload?.taskId as string;
      if (!updateTaskId) {
        sendWs(ws, { type: "error", payload: { message: "taskId required" } });
        return;
      }
      const existingTask = taskStore.getTask(updateTaskId);
      if (!existingTask) {
        sendWs(ws, { type: "error", payload: { message: `Task not found: ${updateTaskId}` } });
        return;
      }

      // Late-bind: associate a running session with this task
      const lateBindSessionId = typeof msg.payload?.sessionId === "string" ? msg.payload.sessionId : "";
      if (lateBindSessionId) {
        const session = sessionStore.getSession(lateBindSessionId);
        if (!session) {
          sendWs(ws, { type: "error", payload: { message: `Session not found: ${lateBindSessionId}` } });
          return;
        }
        const terminalStatuses: string[] = [SESSION_STATUS.COMPLETED, SESSION_STATUS.FAILED, SESSION_STATUS.INTERRUPTED];
        if (terminalStatuses.includes(session.status)) {
          sendWs(ws, {
            type: "error",
            payload: { message: `Cannot bind terminal session ${lateBindSessionId} (status: ${session.status})` },
          });
          return;
        }

        // Verify the processor exists before mutating DB state to avoid partial updates
        if (!processorRegistry.get(lateBindSessionId)) {
          sendWs(ws, {
            type: "error",
            payload: { message: `No active event processor for session ${lateBindSessionId}` },
          });
          return;
        }

        sessionStore.setSessionTask(lateBindSessionId, updateTaskId);

        try {
          processorRegistry.lateBind(lateBindSessionId, updateTaskId, existingTask.workspaceId || undefined);
        } catch (err) {
          sendWs(ws, { type: "error", payload: { message: String(err) } });
          return;
        }

        emit("task.started", { taskId: updateTaskId, sessionId: lateBindSessionId, workspaceId: existingTask.workspaceId || "" });
        break;
      }

      // Only allow editing not_started tasks (non-late-bind path)
      if (existingTask.status !== TASK_STATUS.NOT_STARTED) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Task ${updateTaskId} cannot be edited (status: ${existingTask.status})` },
        });
        return;
      }
      const updatedTitle = typeof msg.payload?.title === "string" && msg.payload.title.trim()
        ? msg.payload.title.trim()
        : existingTask.title;
      const updatedDescription = typeof msg.payload?.description === "string"
        ? msg.payload.description
        : existingTask.description;
      const updatedDependsOn = Array.isArray(msg.payload?.dependsOn)
        ? [
            // Normalise: keep only non-empty strings, remove self-references and duplicates.
            ...new Set(
              (msg.payload.dependsOn as unknown[])
                .filter((d): d is string => typeof d === "string" && d.trim() !== "")
                .filter((d) => d !== updateTaskId),
            ),
          ]
        : safeParseJsonArray(existingTask.dependsOn);
      const updatedDefaultPersonaId = typeof msg.payload?.defaultPersonaId === "string"
        ? msg.payload.defaultPersonaId as string
        : undefined;
      taskStore.updateTask(
        updateTaskId,
        updatedTitle,
        updatedDescription,
        existingTask.status,
        updatedDependsOn,
        updatedDefaultPersonaId,
      );
      emit("task.updated", { taskId: updateTaskId, workspaceId: existingTask.workspaceId || "" });
      break;
    }

    case "start_task": {
      const taskId = msg.payload?.taskId as string;
      if (!taskId) return;

      const task = taskStore.getTask(taskId);
      if (!task) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Task not found: ${taskId}` },
        });
        return;
      }
      {
        const taskSessions = sessionStore.listSessionsForTask(taskId);
        const { status: effectiveStatus } = computeTaskStatus(task.status, taskSessions);
        if (taskId === ROOT_TASK_ID) {
          // Root task is always re-startable unless actively working
          if (effectiveStatus === TASK_STATUS.WORKING) {
            sendWs(ws, {
              type: "error",
              payload: { message: "System is already running" },
            });
            return;
          }
        } else if (!([TASK_STATUS.NOT_STARTED, TASK_STATUS.FAILED] as string[]).includes(effectiveStatus)) {
          sendWs(ws, {
            type: "error",
            payload: {
              message: `Task cannot be started (status: ${effectiveStatus})`,
            },
          });
          return;
        }
      }
      if (!taskStore.areDependenciesMet(taskId)) {
        sendWs(ws, {
          type: "error",
          payload: { message: "Task has unmet dependencies" },
        });
        return;
      }

      const startError = await startTaskSession(ws, task, {
        personaId: (msg.payload?.personaId as string) || undefined,
        environmentId: (msg.payload?.environmentId as string) || undefined,
        notes: (msg.payload?.notes as string) || undefined,
      });
      if (startError) {
        sendWs(ws, { type: "error", payload: { message: startError } });
      }
      break;
    }

    case "complete_task": {
      const taskId = msg.payload?.taskId as string;
      if (!taskId) return;

      taskStore.markTaskComplete(taskId, TASK_STATUS.COMPLETE);
      const task = taskStore.getTask(taskId);
      const unblocked = task?.workspaceId ? taskStore.checkAndUnblock(task.workspaceId) : [];
      sendWs(ws, {
        type: "task_completed",
        payload: {
          taskId,
          unblockedTaskIds: unblocked.map((t) => t.id),
        },
      });
      if (task) {
        emit("task.completed", { taskId, workspaceId: task.workspaceId || "" });
      }
      break;
    }

    case "resume_task": {
      const taskId = msg.payload?.taskId as string;
      if (!taskId) return;

      const task = taskStore.getTask(taskId);
      if (!task) {
        sendWs(ws, { type: "error", payload: { message: `Task not found: ${taskId}` } });
        return;
      }

      const latestSession = sessionStore.getLatestSessionForTask(taskId);
      if (!latestSession) {
        sendWs(ws, { type: "error", payload: { message: `Task ${taskId} has no sessions to resume` } });
        return;
      }
      if (!([SESSION_STATUS.INTERRUPTED, SESSION_STATUS.COMPLETED] as string[]).includes(latestSession.status)) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Latest session ${latestSession.id} is not resumable (status: ${latestSession.status})` },
        });
        return;
      }
      if (!latestSession.runtimeSessionId) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Latest session ${latestSession.id} has no runtime session ID — cannot resume` },
        });
        return;
      }

      const env = envRegistry.getEnvironment(latestSession.environmentId);
      if (!env) {
        sendWs(ws, { type: "error", payload: { message: `Environment not found: ${latestSession.environmentId}` } });
        return;
      }

      const conn = await autoProvisionEnvironment(ws, latestSession.environmentId, env, { taskId });
      if (!conn) {
        return;
      }

      const powerlineReq = create(powerline.ResumeRequestSchema, {
        sessionId: latestSession.id,
        runtimeSessionId: latestSession.runtimeSessionId,
        runtime: latestSession.runtime,
      });

      const logPath = latestSession.logPath || join(grackleHome, LOGS_DIR, latestSession.id);

      processEventStream(conn.client.resume(powerlineReq), {
        sessionId: latestSession.id,
        logPath,
        workspaceId: task.workspaceId ?? undefined,
        taskId: task.id,
      });

      emit("task.started", { taskId: task.id, sessionId: latestSession.id, workspaceId: task.workspaceId || "" });
      break;
    }

    case "delete_task": {
      const taskId = msg.payload?.taskId as string;
      if (!taskId) return;
      const deletedTask = taskStore.getTask(taskId);
      if (!deletedTask) {
        sendWs(ws, { type: "error", payload: { message: `Task not found: ${taskId}` } });
        return;
      }
      const children = taskStore.getChildren(taskId);
      if (children.length > 0) {
        sendWs(ws, {
          type: "error",
          payload: {
            message: "Cannot delete task with children. Delete children first.",
          },
        });
        return;
      }

      // Kill all active sessions before deleting the task
      const activeSessions = sessionStore.getActiveSessionsForTask(taskId);
      for (const activeSession of activeSessions) {
        const conn = adapterManager.getConnection(activeSession.environmentId);
        if (conn) {
          try {
            await conn.client.kill(create(powerline.SessionIdSchema, { id: activeSession.id }));
          } catch (err) {
            logger.warn({ taskId, sessionId: activeSession.id, err }, "Failed to kill session during task deletion");
          }
        }
        sessionStore.updateSession(activeSession.id, SESSION_STATUS.INTERRUPTED);
        streamHub.publish(create(grackle.SessionEventSchema, {
          sessionId: activeSession.id,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: SESSION_STATUS.INTERRUPTED,
          raw: "",
        }));
      }

      const changes = taskStore.deleteTask(taskId);
      if (changes === 0) {
        logger.error({ taskId }, "deleteTask returned 0 changes despite task existing");
        sendWs(ws, { type: "error", payload: { message: `Failed to delete task ${taskId}: no rows affected` } });
        return;
      }
      emit("task.deleted", { taskId, workspaceId: deletedTask.workspaceId || "" });
      break;
    }

    // ─── Task Sessions ─────────────────────────────────────

    case "get_task_sessions": {
      const taskId = msg.payload?.taskId;
      if (typeof taskId !== "string" || taskId.length === 0) {
        return;
      }
      const taskSessions = sessionStore.listSessionsForTask(taskId);
      sendWs(ws, {
        type: "task_sessions",
        payload: {
          taskId,
          sessions: taskSessions.map((r) => ({
            id: r.id,
            environmentId: r.environmentId,
            runtime: r.runtime,
            status: r.status,
            prompt: r.prompt,
            startedAt: r.startedAt,
            endedAt: r.endedAt ?? "",
            error: r.error ?? "",
            personaId: r.personaId,
          })),
        },
      });
      break;
    }

    // ─── Findings ──────────────────────────────────────────

    case "list_findings": {
      const workspaceId = msg.payload?.workspaceId as string;
      if (!workspaceId) return;
      const rows = findingStore.queryFindings(
        workspaceId,
        (msg.payload?.categories as string[] | undefined) || undefined,
        (msg.payload?.tags as string[] | undefined) || undefined,
        (msg.payload?.limit as number | undefined) || undefined,
      );
      sendWs(ws, {
        type: "findings",
        payload: {
          workspaceId,
          findings: rows.map((r) => ({
            id: r.id,
            workspaceId: r.workspaceId,
            taskId: r.taskId,
            sessionId: r.sessionId,
            category: r.category,
            title: r.title,
            content: r.content,
            tags: safeParseJsonArray(r.tags),
            createdAt: r.createdAt,
          })),
        },
      });
      break;
    }

    case "post_finding": {
      const workspaceId = msg.payload?.workspaceId as string;
      const title = msg.payload?.title as string;
      if (!workspaceId || !title) {
        sendWs(ws, {
          type: "error",
          payload: { message: "workspaceId and title required" },
        });
        return;
      }
      const id = uuid().slice(0, 8);
      findingStore.postFinding(
        id,
        workspaceId,
        (msg.payload?.taskId as string | undefined) || "",
        (msg.payload?.sessionId as string | undefined) || "",
        (msg.payload?.category as string | undefined) || "general",
        title,
        (msg.payload?.content as string | undefined) || "",
        (msg.payload?.tags as string[] | undefined) || [],
      );
      sendWs(ws, { type: "finding_posted", payload: { id, workspaceId } });
      break;
    }

    case "provision_environment": {
      const environmentId = msg.payload?.environmentId as string;
      if (!environmentId) {
        sendWs(ws, {
          type: "error",
          payload: { message: "environmentId required" },
        });
        return;
      }

      const env = envRegistry.getEnvironment(environmentId);
      if (!env) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Environment not found: ${environmentId}` },
        });
        return;
      }

      const adapter = adapterManager.getAdapter(env.adapterType);
      if (!adapter) {
        sendWs(ws, {
          type: "error",
          payload: { message: `No adapter for type: ${env.adapterType}` },
        });
        return;
      }

      logger.info(
        { environmentId, adapterType: env.adapterType },
        "Provisioning environment",
      );
      envRegistry.updateEnvironmentStatus(environmentId, "connecting");
      emit("environment.changed", {});

      // Run provision in background, broadcasting progress to all connected clients
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (async () => {
        try {
          const config = safeParseAdapterConfig(
            env.adapterConfig,
            environmentId,
          );
          config.defaultRuntime = env.defaultRuntime;
          const powerlineToken = env.powerlineToken || "";

          for await (const event of reconnectOrProvision(
            environmentId,
            adapter,
            config,
            powerlineToken,
            !!env.bootstrapped,
          )) {
            logger.info(
              { environmentId, stage: event.stage, message: event.message },
              "Provision progress",
            );
            emit("environment.provision_progress", {
              environmentId,
              stage: event.stage,
              message: event.message,
              progress: event.progress,
            });
          }

          logger.info(
            { environmentId },
            "Provision complete, calling adapter.connect",
          );
          const conn = await adapter.connect(
            environmentId,
            config,
            powerlineToken,
          );
          adapterManager.setConnection(environmentId, conn);
          // Push stored tokens to newly connected environment
          await tokenBroker.pushToEnv(environmentId);
          envRegistry.updateEnvironmentStatus(environmentId, "connected");
          envRegistry.markBootstrapped(environmentId);
          logger.info({ environmentId }, "Environment connected");
          emit("environment.provision_progress", {
            environmentId,
            stage: "ready",
            message: "Environment connected",
            progress: 1,
          });
        } catch (err) {
          logger.error({ environmentId, err }, "Provision failed");
          envRegistry.updateEnvironmentStatus(environmentId, "error");
          const errorMessage = err instanceof Error ? err.message : String(err);
          emit("environment.provision_progress", {
            environmentId,
            stage: "error",
            message: `Connection failed: ${errorMessage}`,
            progress: 0,
          });
        }
        emit("environment.changed", {});
      })();
      break;
    }

    case "stop_environment": {
      const environmentId = msg.payload?.environmentId as string;
      if (!environmentId) {
        sendWs(ws, {
          type: "error",
          payload: { message: "environmentId required" },
        });
        return;
      }

      const env = envRegistry.getEnvironment(environmentId);
      if (!env) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Environment not found: ${environmentId}` },
        });
        return;
      }

      const adapter = adapterManager.getAdapter(env.adapterType);
      if (adapter) {
        const config = safeParseAdapterConfig(env.adapterConfig, environmentId);
        await adapter.stop(environmentId, config);
      }
      adapterManager.removeConnection(environmentId);
      envRegistry.updateEnvironmentStatus(environmentId, "disconnected");
      logger.info({ environmentId }, "Environment stopped");
      emit("environment.changed", {});
      break;
    }

    case "add_environment": {
      const displayName = (msg.payload?.displayName as string) || "";
      const adapterType = (msg.payload?.adapterType as string) || "";
      if (!displayName || !adapterType) {
        sendWs(ws, {
          type: "error",
          payload: { message: "displayName and adapterType required" },
        });
        return;
      }
      if (!adapterManager.getAdapter(adapterType)) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Unknown adapter type: ${adapterType}` },
        });
        return;
      }
      const baseEnvId = slugify(displayName) || uuid().slice(0, 8);
      let id = baseEnvId;
      for (
        let attempt = 0;
        attempt < 10 && envRegistry.getEnvironment(id);
        attempt++
      ) {
        id = `${baseEnvId}-${uuid().slice(0, 4)}`;
      }
      if (envRegistry.getEnvironment(id)) {
        id = uuid();
      }
      const rawAdapterConfig = msg.payload?.adapterConfig;
      let adapterConfig: string;
      if (rawAdapterConfig === undefined || rawAdapterConfig === null) {
        adapterConfig = "{}";
      } else if (typeof rawAdapterConfig === "string") {
        const normalized =
          rawAdapterConfig.trim() === "" ? "{}" : rawAdapterConfig;
        try {
          JSON.parse(normalized);
        } catch {
          sendWs(ws, {
            type: "error",
            payload: { message: "adapterConfig string is not valid JSON" },
          });
          return;
        }
        adapterConfig = normalized;
      } else if (typeof rawAdapterConfig === "object") {
        adapterConfig = JSON.stringify(rawAdapterConfig);
      } else {
        sendWs(ws, {
          type: "error",
          payload: {
            message: "adapterConfig must be an object or JSON string",
          },
        });
        return;
      }
      envRegistry.addEnvironment(
        id,
        displayName,
        adapterType,
        adapterConfig,
      );
      logger.info(
        { id, displayName, adapterType },
        "Environment added via WebSocket",
      );
      emit("environment.added", { environmentId: id });
      emit("environment.changed", {});
      break;
    }

    case "update_environment": {
      const environmentId = msg.payload?.environmentId as string;
      if (!environmentId) {
        sendWs(ws, { type: "error", payload: { message: "environmentId required" } });
        return;
      }
      const existing = envRegistry.getEnvironment(environmentId);
      if (!existing) {
        sendWs(ws, { type: "error", payload: { message: `Environment not found: ${environmentId}` } });
        return;
      }
      const nameVal = typeof msg.payload?.displayName === "string" ? msg.payload.displayName : undefined;
      if (nameVal?.trim() === "") {
        sendWs(ws, { type: "error", payload: { message: "Environment name cannot be empty" } });
        return;
      }
      let configVal: string | undefined;
      const rawConfig = msg.payload?.adapterConfig;
      if (rawConfig !== undefined) {
        if (rawConfig === null) {
          configVal = "{}";
        } else if (typeof rawConfig === "string") {
          const normalized = rawConfig.trim() === "" ? "{}" : rawConfig;
          let parsed: unknown;
          try {
            parsed = JSON.parse(normalized);
          } catch {
            sendWs(ws, { type: "error", payload: { message: "adapterConfig string is not valid JSON" } });
            return;
          }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            sendWs(ws, { type: "error", payload: { message: "adapterConfig must be a JSON object" } });
            return;
          }
          configVal = normalized;
        } else if (typeof rawConfig === "object") {
          if (Array.isArray(rawConfig)) {
            sendWs(ws, { type: "error", payload: { message: "adapterConfig must be a JSON object" } });
            return;
          }
          configVal = JSON.stringify(rawConfig);
        } else {
          sendWs(ws, { type: "error", payload: { message: "adapterConfig must be a JSON object" } });
          return;
        }
      }
      const trimmedName = nameVal !== undefined ? nameVal.trim() : undefined;
      if (trimmedName === undefined && configVal === undefined) {
        sendWs(ws, { type: "error", payload: { message: "No updatable fields provided" } });
        return;
      }
      envRegistry.updateEnvironment(environmentId, {
        displayName: trimmedName,
        adapterConfig: configVal,
      });
      logger.info({ environmentId, displayName: trimmedName }, "Environment updated via WebSocket");
      emit("environment.changed", {});
      break;
    }

    case "remove_environment": {
      const environmentId = msg.payload?.environmentId as string;
      if (!environmentId) {
        sendWs(ws, {
          type: "error",
          payload: { message: "environmentId required" },
        });
        return;
      }

      // Block deletion if workspaces still reference this environment
      const wsCount = workspaceStore.countWorkspacesByEnvironment(environmentId);
      if (wsCount > 0) {
        sendWs(ws, {
          type: "error",
          payload: {
            message: `Cannot remove environment: ${wsCount} active workspace(s) still reference it. Archive or reparent them first.`,
          },
        });
        return;
      }

      const env = envRegistry.getEnvironment(environmentId);
      if (env) {
        const adapter = adapterManager.getAdapter(env.adapterType);
        if (adapter) {
          const config = safeParseAdapterConfig(
            env.adapterConfig,
            environmentId,
          );
          try {
            await adapter.destroy(environmentId, config);
          } catch {
            /* best-effort */
          }
          try {
            await adapter.disconnect(environmentId);
          } catch {
            /* best-effort */
          }
        }
      }
      adapterManager.removeConnection(environmentId);
      sessionStore.deleteByEnvironment(environmentId);
      envRegistry.removeEnvironment(environmentId);
      logger.info({ environmentId }, "Environment removed");
      emit("environment.removed", { environmentId });
      emit("environment.changed", {});
      break;
    }

    // ─── Codespaces ─────────────────────────────────────

    case "list_codespaces": {
      try {
        const result = await exec(
          "gh",
          [
            "codespace",
            "list",
            "--json",
            "name,repository,state,gitStatus",
            "--limit",
            String(GH_CODESPACE_LIST_LIMIT),
          ],
          { timeout: GH_CODESPACE_LIST_TIMEOUT_MS },
        );
        const codespaces = JSON.parse(result.stdout || "[]") as Array<
          Record<string, unknown>
        >;
        sendWs(ws, { type: "codespaces_list", payload: { codespaces } });
      } catch (err) {
        logger.warn({ err }, "Failed to list codespaces");
        sendWs(ws, {
          type: "codespaces_list",
          payload: {
            codespaces: [],
            error: formatGhError(err, "list codespaces"),
          },
        });
      }
      break;
    }

    case "create_codespace": {
      const repo = msg.payload?.repo;
      if (typeof repo !== "string" || repo.trim().length === 0) {
        sendWs(ws, {
          type: "codespace_create_error",
          payload: { message: "repo required" },
        });
        return;
      }
      const trimmedRepo = repo.trim();
      const machine =
        typeof msg.payload?.machine === "string"
          ? msg.payload.machine.trim()
          : "";
      const createArgs = ["codespace", "create", "--repo", trimmedRepo];
      if (machine) {
        createArgs.push("--machine", machine);
      }
      try {
        const result = await exec("gh", createArgs, {
          timeout: GH_CODESPACE_CREATE_TIMEOUT_MS,
        });
        const codespaceName = result.stdout.trim();
        sendWs(ws, {
          type: "codespace_created",
          payload: { name: codespaceName, repository: trimmedRepo },
        });
      } catch (err) {
        logger.error({ err, repo }, "Failed to create codespace");
        sendWs(ws, {
          type: "codespace_create_error",
          payload: { message: formatGhError(err, "create codespace") },
        });
      }
      break;
    }

    // ─── Tokens ───────────────────────────────────────────

    case "list_tokens": {
      const items = tokenBroker.listTokens();
      sendWs(ws, {
        type: "tokens",
        payload: {
          tokens: items.map((t) => ({
            name: t.name,
            tokenType: t.type,
            envVar: t.envVar || "",
            filePath: t.filePath || "",
            expiresAt: t.expiresAt || "",
          })),
        },
      });
      break;
    }

    case "set_token": {
      const name = msg.payload?.name as string;
      const value = msg.payload?.value as string;
      if (!name || !value) {
        sendWs(ws, {
          type: "error",
          payload: { message: "name and value required" },
        });
        return;
      }
      await tokenBroker.setToken({
        name,
        type: (msg.payload?.tokenType as string) || "env_var",
        envVar: (msg.payload?.envVar as string) || "",
        filePath: (msg.payload?.filePath as string) || "",
        value,
        expiresAt: (msg.payload?.expiresAt as string) || "",
      });
      emit("token.changed", {});
      break;
    }

    case "delete_token": {
      const tokenName = msg.payload?.name as string;
      if (!tokenName) {
        sendWs(ws, { type: "error", payload: { message: "name required" } });
        return;
      }
      await tokenBroker.deleteToken(tokenName);
      emit("token.changed", {});
      break;
    }

    case "get_credential_providers": {
      const config = credentialProviders.getCredentialProviders();
      sendWs(ws, {
        type: "credential_providers",
        payload: config as unknown as Record<string, unknown>,
      });
      break;
    }

    case "set_credential_providers": {
      if (!credentialProviders.isValidCredentialProviderConfig(msg.payload)) {
        sendWs(ws, { type: "error", payload: { message: "invalid credential provider config" } });
        return;
      }
      credentialProviders.setCredentialProviders(msg.payload);
      emit("credential.providers_changed", credentialProviders.getCredentialProviders() as unknown as Record<string, unknown>);
      break;
    }
  }
}

function sendWs(
  ws: WebSocket,
  msg: { type: string; payload?: Record<string, unknown> },
): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
