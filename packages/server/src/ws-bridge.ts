import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";
import * as envRegistry from "./env-registry.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import {
  type PowerLineConnection,
  reconnectOrProvision,
} from "@grackle-ai/adapter-sdk";
import * as streamHub from "./stream-hub.js";
import * as tokenBroker from "./token-broker.js";
import * as workspaceStore from "./workspace-store.js";
import * as taskStore from "./task-store.js";
import { v4 as uuid } from "uuid";
import { join } from "node:path";
import {
  LOGS_DIR,
  DEFAULT_MCP_PORT,
  ROOT_TASK_ID,
  eventTypeToString,
} from "@grackle-ai/common";
import { resolvePersona } from "./resolve-persona.js";
import { fetchOrchestratorContext } from "./orchestrator-context.js";
import { grackleHome } from "./paths.js";
import { logger } from "./logger.js";
import { SystemPromptBuilder, buildTaskPrompt } from "./system-prompt-builder.js";
import { processEventStream } from "./event-processor.js";
import { setWssInstance } from "./ws-broadcast.js";
import { emit } from "./event-bus.js";
import { recoverSuspendedSessions } from "./session-recovery.js";
import { buildMcpServersJson, toDialableHost } from "./grpc-service.js";
import { createScopedToken } from "@grackle-ai/mcp";
import { loadOrCreateApiKey } from "./api-key.js";

const WS_PING_INTERVAL_MS: number = 30_000;
const WS_CLOSE_UNAUTHORIZED: number = 4001;

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
  id?: string;
}

/** Create a WebSocket server on top of an HTTP server that bridges JSON messages to gRPC operations. */
/** Options for creating the WebSocket bridge. */
interface WsBridgeOptions {
  verifyApiKey: (token: string) => boolean;
  validateCookie?: (cookieHeader: string) => boolean;
  webPort?: number;
  allowNetwork?: boolean;
}

/** Create a WebSocket server on top of an HTTP server for real-time event streaming. */
export function createWsBridge(
  httpServer: HttpServer,
  options: WsBridgeOptions,
): WebSocketServer {
  const { verifyApiKey, validateCookie } = options;
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
    // Auto-recover suspended sessions (fire-and-forget)
    recoverSuspendedSessions(environmentId, conn).catch((err) => {
      logger.error({ environmentId, err }, "Session recovery failed");
    });
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

/** Start a new agent session for a task. Returns an error message string on failure, undefined on success. */
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

    default:
      // ignore unknown messages
      break;
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
