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
} from "./adapters/adapter.js";
import * as streamHub from "./stream-hub.js";
import * as tokenBroker from "./token-broker.js";
import * as projectStore from "./project-store.js";
import * as taskStore from "./task-store.js";
import * as findingStore from "./finding-store.js";
import * as personaStore from "./persona-store.js";
import { v4 as uuid } from "uuid";
import { join } from "node:path";
import {
  LOGS_DIR,
  DEFAULT_RUNTIME,
  DEFAULT_MODEL,
  eventTypeToString,
} from "@grackle-ai/common";
import { grackleHome } from "./paths.js";
import * as logWriter from "./log-writer.js";
import { safeParseJsonArray } from "./json-helpers.js";
import { logger } from "./logger.js";
import { buildTaskSystemContext } from "./utils/system-context.js";
import { slugify } from "./utils/slugify.js";
import { processEventStream } from "./event-processor.js";
import { broadcast, setWssInstance } from "./ws-broadcast.js";
import { buildMcpServersJson } from "./grpc-service.js";
import { exec } from "./utils/exec.js";

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
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer });
  setWssInstance(wss);

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "/", "http://localhost");
    const token = url.searchParams.get("token") || "";
    if (!verifyApiKey(token)) {
      ws.close(WS_CLOSE_UNAUTHORIZED, "Unauthorized");
      return;
    }

    const subscriptions = new Map<string, { cancel(): void }>();

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

/** Map a database environment row to the WebSocket payload shape. */
function envRowToWs(
  r: ReturnType<typeof envRegistry.listEnvironments>[number],
): Record<string, unknown> {
  return {
    id: r.id,
    displayName: r.displayName,
    adapterType: r.adapterType,
    adapterConfig: r.adapterConfig,
    defaultRuntime: r.defaultRuntime,
    status: r.status,
    bootstrapped: r.bootstrapped,
  };
}

/** Broadcast the current environment list to all connected WebSocket clients. */
function broadcastEnvironments(): void {
  broadcast({
    type: "environments",
    payload: { environments: envRegistry.listEnvironments().map(envRowToWs) },
  });
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
  broadcastEnvironments();

  try {
    const config = safeParseAdapterConfig(env.adapterConfig, environmentId);
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
      broadcast({
        type: "provision_progress",
        payload: {
          environmentId,
          stage: provEvent.stage,
          message: provEvent.message,
          progress: provEvent.progress,
        },
      });
    }

    conn = await adapter.connect(environmentId, config, powerlineToken);
    adapterManager.setConnection(environmentId, conn);
    // Push stored tokens to newly connected environment
    await tokenBroker.pushToEnv(environmentId);
    envRegistry.updateEnvironmentStatus(environmentId, "connected");
    envRegistry.markBootstrapped(environmentId);
    broadcastEnvironments();
    logger.info({ environmentId, ...logContext }, "Auto-provision complete");
    broadcast({
      type: "provision_progress",
      payload: {
        environmentId,
        stage: "ready",
        message: "Environment connected",
        progress: 1,
      },
    });
    return conn;
  } catch (err) {
    logger.error(
      { environmentId, ...logContext, err },
      "Auto-provision failed",
    );
    envRegistry.updateEnvironmentStatus(environmentId, "error");
    broadcastEnvironments();
    const errorMessage = err instanceof Error ? err.message : String(err);
    broadcast({
      type: "provision_progress",
      payload: {
        environmentId,
        stage: "error",
        message: `Auto-provision failed: ${errorMessage}`,
        progress: 0,
      },
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
async function startTaskSession(
  ws: WebSocket,
  task: taskStore.TaskRow,
  options?: { runtime?: string; model?: string; personaId?: string },
): Promise<string | undefined> {
  const project = projectStore.getProject(task.projectId);
  if (!project) {
    logger.warn(
      { taskId: task.id },
      "startTaskSession failed: project not found",
    );
    return `Project not found: ${task.projectId}`;
  }

  const environmentId = task.environmentId || project.defaultEnvironmentId;
  const env = envRegistry.getEnvironment(environmentId);
  if (!env) {
    logger.warn(
      { taskId: task.id, environmentId },
      "startTaskSession failed: environment not found",
    );
    return `Environment not found: ${environmentId}`;
  }

  const conn = await autoProvisionEnvironment(ws, environmentId, env, {
    taskId: task.id,
  });
  if (!conn) {
    return undefined;
  }

  // Resolve persona
  const resolvedPersonaId = options?.personaId || task.personaId;
  const persona = resolvedPersonaId
    ? personaStore.getPersona(resolvedPersonaId)
    : undefined;
  if (resolvedPersonaId && !persona) {
    return `Persona not found: ${resolvedPersonaId}`;
  }

  const sessionId = uuid();
  const runtime =
    options?.runtime ||
    persona?.runtime ||
    env.defaultRuntime ||
    DEFAULT_RUNTIME;
  const model =
    options?.model ||
    persona?.model ||
    process.env.GRACKLE_DEFAULT_MODEL ||
    DEFAULT_MODEL;
  const maxTurns = persona?.maxTurns || 0;
  const logPath = join(grackleHome, LOGS_DIR, sessionId);

  const freshTask = taskStore.getTask(task.id) || task;
  let systemContext = buildTaskSystemContext(
    freshTask.title,
    freshTask.description,
    freshTask.reviewNotes,
    freshTask.canDecompose,
  );
  if (persona) {
    systemContext = persona.systemPrompt + "\n\n" + systemContext;
  }

  sessionStore.createSession(
    sessionId,
    environmentId,
    runtime,
    freshTask.title,
    model,
    logPath,
    freshTask.id,
  );
  taskStore.setTaskSession(freshTask.id, sessionId);
  taskStore.markTaskStarted(freshTask.id);

  broadcast({
    type: "task_started",
    payload: {
      taskId: freshTask.id,
      sessionId,
      projectId: freshTask.projectId,
    },
  });

  let mcpServersJson = "";
  if (persona) {
    try {
      const parsed: unknown = JSON.parse(persona.mcpServers || "[]");
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
  }

  const powerlineReq = create(powerline.SpawnRequestSchema, {
    sessionId,
    runtime,
    prompt: freshTask.title,
    model,
    maxTurns,
    branch: freshTask.branch,
    worktreeBasePath: freshTask.branch
      ? process.env.GRACKLE_WORKTREE_BASE || "/workspace"
      : "",
    systemContext,
    projectId: freshTask.projectId,
    taskId: freshTask.id,
    mcpServersJson,
  });

  processEventStream(conn.client.spawn(powerlineReq), {
    sessionId,
    logPath,
    projectId: freshTask.projectId,
    taskId: freshTask.id,
    onComplete: () => {
      const t = taskStore.getTask(freshTask.id);
      if (t && (t.status === "in_progress" || t.status === "waiting_input")) {
        const sess = sessionStore.getSession(sessionId);
        if (sess?.status === "completed") {
          taskStore.markTaskCompleted(freshTask.id, "review");
        } else if (sess?.status === "failed") {
          taskStore.markTaskCompleted(freshTask.id, "failed");
        }
        broadcast({
          type: "task_updated",
          payload: { taskId: freshTask.id, projectId: freshTask.projectId },
        });
      }
    },
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
      if (!session || !session.logPath) {
        return;
      }

      const entries = logWriter.readLog(session.logPath);
      const events = entries.map((e) => ({
        sessionId: e.session_id,
        eventType: e.type,
        timestamp: e.timestamp,
        content: e.content,
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
            },
          });
        }
      })();
      break;
    }

    case "spawn": {
      const environmentId = msg.payload?.environmentId as string;
      const prompt = msg.payload?.prompt as string;
      const model = (msg.payload?.model as string) || "";
      const runtime = (msg.payload?.runtime as string) || "";
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

      // Resolve persona if specified
      const spawnPersona = spawnPersonaId ? personaStore.getPersona(spawnPersonaId) : undefined;
      if (spawnPersonaId && !spawnPersona) {
        sendWs(ws, { type: "error", payload: { message: `Persona not found: ${spawnPersonaId}` } });
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
      const sessionRuntime = runtime || spawnPersona?.runtime || env.defaultRuntime || DEFAULT_RUNTIME;
      const sessionModel =
        model || spawnPersona?.model || process.env.GRACKLE_DEFAULT_MODEL || DEFAULT_MODEL;
      const maxTurns = spawnPersona?.maxTurns || 0;
      const logPath = join(grackleHome, LOGS_DIR, sessionId);

      let finalSystemContext = systemContext;
      if (spawnPersona) {
        finalSystemContext = spawnPersona.systemPrompt + (systemContext ? "\n\n" + systemContext : "");
      }

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
        worktreeBasePath: branch ? "/workspace" : "",
        systemContext: finalSystemContext,
      });

      processEventStream(conn.client.spawn(powerlineReq), {
        sessionId,
        logPath,
        onError: (err) => {
          sendWs(ws, {
            type: "session_event",
            payload: {
              sessionId,
              eventType: "error",
              timestamp: new Date().toISOString(),
              content: `Spawn failed: ${err}`,
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

      if (session.status !== "waiting_input") {
        sendWs(ws, {
          type: "error",
          payload: {
            message: `Session ${sessionId} is not currently waiting for input (status: ${session.status})`,
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
          sendWs(ws, {
            type: "error",
            payload: { message: `Kill failed: ${err}` },
          });
          return;
        }
      }
      sessionStore.updateSession(sessionId, "killed");
      streamHub.publish(
        create(grackle.SessionEventSchema, {
          sessionId,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: "killed",
          raw: "",
        }),
      );
      break;
    }

    // ─── Projects ──────────────────────────────────────────

    case "list_projects": {
      const rows = projectStore.listProjects();
      sendWs(ws, {
        type: "projects",
        payload: {
          projects: rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            repoUrl: r.repoUrl,
            defaultEnvironmentId: r.defaultEnvironmentId,
            status: r.status,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
        },
      });
      break;
    }

    case "create_project": {
      const name = msg.payload?.name as string;
      if (!name) {
        sendWs(ws, { type: "error", payload: { message: "name required" } });
        return;
      }
      const baseProjectId = slugify(name) || uuid().slice(0, 8);
      let id = baseProjectId;
      for (
        let attempt = 0;
        attempt < 10 && projectStore.getProject(id);
        attempt++
      ) {
        id = `${baseProjectId}-${uuid().slice(0, 4)}`;
      }
      if (projectStore.getProject(id)) {
        id = uuid();
      }
      projectStore.createProject(
        id,
        name,
        (msg.payload?.description as string) || "",
        (msg.payload?.repoUrl as string) || "",
        (msg.payload?.defaultEnvironmentId as string) || "",
      );
      const row = projectStore.getProject(id);
      broadcast({ type: "project_created", payload: { project: row } });
      break;
    }

    case "archive_project": {
      const projectId = msg.payload?.projectId as string;
      if (projectId) projectStore.archiveProject(projectId);
      broadcast({ type: "project_archived", payload: { projectId } });
      break;
    }

    case "update_project": {
      const projectId = msg.payload?.projectId as string;
      if (!projectId) {
        sendWs(ws, { type: "error", payload: { message: "projectId required" } });
        return;
      }
      const existing = projectStore.getProject(projectId);
      if (!existing) {
        sendWs(ws, { type: "error", payload: { message: `Project not found: ${projectId}` } });
        return;
      }
      const nameVal = typeof msg.payload?.name === "string" ? msg.payload.name : undefined;
      if (nameVal !== undefined && nameVal.trim() === "") {
        sendWs(ws, { type: "error", payload: { message: "Project name cannot be empty" } });
        return;
      }
      const descVal = typeof msg.payload?.description === "string" ? msg.payload.description : undefined;
      const repoVal = typeof msg.payload?.repoUrl === "string" ? msg.payload.repoUrl : undefined;
      const envVal = typeof msg.payload?.defaultEnvironmentId === "string" ? msg.payload.defaultEnvironmentId : undefined;
      if (repoVal !== undefined && repoVal !== "" && !/^https?:\/\//i.test(repoVal)) {
        sendWs(ws, { type: "error", payload: { message: "Repository URL must use http or https scheme" } });
        return;
      }
      projectStore.updateProject(projectId, {
        name: nameVal !== undefined ? nameVal.trim() : undefined,
        description: descVal,
        repoUrl: repoVal,
        defaultEnvironmentId: envVal,
      });
      broadcast({ type: "project_updated", payload: { projectId } });
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
      const personaSystemPrompt = msg.payload?.systemPrompt as string;
      if (!personaSystemPrompt) {
        sendWs(ws, {
          type: "error",
          payload: { message: "systemPrompt required" },
        });
        return;
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
      );
      broadcast({ type: "persona_created", payload: { personaId } });
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
        (msg.payload?.name as string) || existingPersona.name,
        (msg.payload?.description as string) || existingPersona.description,
        (msg.payload?.systemPrompt as string) || existingPersona.systemPrompt,
        (msg.payload?.toolConfig as string) || existingPersona.toolConfig,
        (msg.payload?.runtime as string) || existingPersona.runtime,
        (msg.payload?.model as string) || existingPersona.model,
        (msg.payload?.maxTurns as number) || existingPersona.maxTurns,
        (msg.payload?.mcpServers as string) || existingPersona.mcpServers,
      );
      broadcast({
        type: "persona_updated",
        payload: { personaId: updatePersonaId },
      });
      break;
    }

    case "delete_persona": {
      const deletePersonaId = msg.payload?.personaId as string;
      if (!deletePersonaId) return;
      personaStore.deletePersona(deletePersonaId);
      broadcast({
        type: "persona_deleted",
        payload: { personaId: deletePersonaId },
      });
      break;
    }

    // ─── Tasks ─────────────────────────────────────────────

    case "list_tasks": {
      const projectId = msg.payload?.projectId as string;
      if (!projectId) return;
      const rows = taskStore.listTasks(projectId);
      const childIdsMap = taskStore.buildChildIdsMap(rows);
      sendWs(ws, {
        type: "tasks",
        payload: {
          projectId,
          tasks: rows.map((r) => ({
            id: r.id,
            projectId: r.projectId,
            title: r.title,
            description: r.description,
            status: r.status,
            branch: r.branch,
            environmentId: r.environmentId,
            sessionId: r.sessionId,
            dependsOn: safeParseJsonArray(r.dependsOn),
            reviewNotes: r.reviewNotes,
            sortOrder: r.sortOrder,
            createdAt: r.createdAt,
            parentTaskId: r.parentTaskId,
            depth: r.depth,
            childTaskIds: childIdsMap.get(r.id) ?? [],
            canDecompose: r.canDecompose,
            personaId: r.personaId,
          })),
        },
      });
      break;
    }

    case "create_task": {
      const projectId = msg.payload?.projectId as string;
      const title = msg.payload?.title as string;
      if (!projectId || !title) {
        sendWs(ws, {
          type: "error",
          payload: { message: "projectId and title required" },
        });
        return;
      }
      const project = projectStore.getProject(projectId);
      if (!project) {
        sendWs(ws, {
          type: "error",
          payload: { message: `Project not found: ${projectId}` },
        });
        return;
      }
      const parentTaskId = (msg.payload?.parentTaskId as string) || "";
      const rawCanDecompose = msg.payload?.canDecompose;
      const canDecompose =
        typeof rawCanDecompose === "boolean" ? rawCanDecompose : undefined;

      // Resolve environment: explicit > parent task's env > project default
      let resolvedEnvId = (msg.payload?.environmentId as string) || "";
      if (!resolvedEnvId && parentTaskId) {
        const parentTask = taskStore.getTask(parentTaskId);
        if (parentTask?.environmentId) {
          resolvedEnvId = parentTask.environmentId;
        }
      }
      if (!resolvedEnvId) {
        resolvedEnvId = project.defaultEnvironmentId;
      }

      const id = uuid().slice(0, 8);
      taskStore.createTask(
        id,
        projectId,
        title,
        (msg.payload?.description as string) || "",
        resolvedEnvId,
        (msg.payload?.dependsOn as string[]) || [],
        slugify(project.name),
        parentTaskId,
        canDecompose,
        (msg.payload?.personaId as string) || "",
      );
      const row = taskStore.getTask(id);
      broadcast({
        type: "task_created",
        payload: {
          task: row
            ? { ...row, dependsOn: safeParseJsonArray(row.dependsOn) }
            : null,
        },
      });
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
      // Only allow editing pending/assigned tasks
      if (!["pending", "assigned"].includes(existingTask.status)) {
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
      const updatedEnvironmentId = typeof msg.payload?.environmentId === "string"
        ? msg.payload.environmentId
        : existingTask.environmentId;
      const updatedPersonaId = typeof msg.payload?.personaId === "string"
        ? msg.payload.personaId
        : existingTask.personaId;
      taskStore.updateTask(
        updateTaskId,
        updatedTitle,
        updatedDescription,
        existingTask.status,
        updatedEnvironmentId,
        updatedDependsOn,
        existingTask.reviewNotes,
        updatedPersonaId,
      );
      const updatedRow = taskStore.getTask(updateTaskId);
      broadcast({
        type: "task_updated",
        payload: {
          taskId: updateTaskId,
          projectId: existingTask.projectId,
          task: updatedRow
            ? { ...updatedRow, dependsOn: safeParseJsonArray(updatedRow.dependsOn) }
            : null,
        },
      });
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
      if (!["pending", "assigned", "failed"].includes(task.status)) {
        sendWs(ws, {
          type: "error",
          payload: {
            message: `Task cannot be started (status: ${task.status})`,
          },
        });
        return;
      }
      if (!taskStore.areDependenciesMet(taskId)) {
        sendWs(ws, {
          type: "error",
          payload: { message: "Task has unmet dependencies" },
        });
        return;
      }

      const startError = await startTaskSession(ws, task, {
        runtime: msg.payload?.runtime as string | undefined,
        model: msg.payload?.model as string | undefined,
        personaId:
          (msg.payload?.personaId as string) || task.personaId || undefined,
      });
      if (startError) {
        sendWs(ws, { type: "error", payload: { message: startError } });
      }
      break;
    }

    case "approve_task": {
      const taskId = msg.payload?.taskId as string;
      if (!taskId) return;

      taskStore.markTaskCompleted(taskId, "done");
      const task = taskStore.getTask(taskId);
      const unblocked = task ? taskStore.checkAndUnblock(task.projectId) : [];
      sendWs(ws, {
        type: "task_approved",
        payload: {
          taskId,
          unblockedTaskIds: unblocked.map((t) => t.id),
        },
      });
      break;
    }

    case "reject_task": {
      const taskId = msg.payload?.taskId as string;
      const reviewNotes = (msg.payload?.reviewNotes as string) || "";
      if (!taskId) return;

      const task = taskStore.getTask(taskId);
      if (!task) return;

      if (task.status !== "review") {
        sendWs(ws, {
          type: "error",
          payload: {
            message: `Task cannot be rejected (status: ${task.status})`,
          },
        });
        return;
      }

      // Preserve runtime/model from the previous session so the retry
      // doesn't unexpectedly switch runtimes/models.
      const previousSession = task.sessionId
        ? sessionStore.getSession(task.sessionId)
        : undefined;

      // Store review notes and set status to assigned
      taskStore.updateTask(
        task.id,
        task.title,
        task.description,
        "assigned",
        task.environmentId,
        safeParseJsonArray(task.dependsOn),
        reviewNotes,
        task.personaId,
      );
      broadcast({
        type: "task_rejected",
        payload: { taskId, projectId: task.projectId },
      });

      // Auto-retry: start a new session with the review feedback
      const freshTask = taskStore.getTask(taskId);
      if (freshTask) {
        const retryError = await startTaskSession(ws, freshTask, {
          runtime: previousSession?.runtime,
          model: previousSession?.model,
        });
        if (retryError) {
          logger.warn(
            { taskId, error: retryError },
            "Auto-retry after rejection failed — task remains assigned",
          );
        }
      }
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

      // Kill active session before deleting the task
      if (deletedTask.sessionId) {
        const activeSession = sessionStore.getSession(deletedTask.sessionId);
        if (activeSession && (activeSession.status === "running" || activeSession.status === "waiting_input")) {
          const conn = adapterManager.getConnection(activeSession.environmentId);
          if (conn) {
            try {
              await conn.client.kill(create(powerline.SessionIdSchema, { id: deletedTask.sessionId }));
            } catch (err) {
              logger.warn({ taskId, sessionId: deletedTask.sessionId, err }, "Failed to kill session during task deletion");
            }
          }
          sessionStore.updateSession(deletedTask.sessionId, "killed");
          streamHub.publish(create(grackle.SessionEventSchema, {
            sessionId: deletedTask.sessionId,
            type: grackle.EventType.STATUS,
            timestamp: new Date().toISOString(),
            content: "killed",
            raw: "",
          }));
        }
      }

      const changes = taskStore.deleteTask(taskId);
      if (changes === 0) {
        logger.error({ taskId }, "deleteTask returned 0 changes despite task existing");
        sendWs(ws, { type: "error", payload: { message: `Failed to delete task ${taskId}: no rows affected` } });
        return;
      }
      broadcast({ type: "task_deleted", payload: { taskId, projectId: deletedTask.projectId } });
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
          })),
        },
      });
      break;
    }

    // ─── Findings ──────────────────────────────────────────

    case "list_findings": {
      const projectId = msg.payload?.projectId as string;
      if (!projectId) return;
      const rows = findingStore.queryFindings(
        projectId,
        (msg.payload?.categories as string[]) || undefined,
        (msg.payload?.tags as string[]) || undefined,
        (msg.payload?.limit as number) || undefined,
      );
      sendWs(ws, {
        type: "findings",
        payload: {
          projectId,
          findings: rows.map((r) => ({
            id: r.id,
            projectId: r.projectId,
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
      const projectId = msg.payload?.projectId as string;
      const title = msg.payload?.title as string;
      if (!projectId || !title) {
        sendWs(ws, {
          type: "error",
          payload: { message: "projectId and title required" },
        });
        return;
      }
      const id = uuid().slice(0, 8);
      findingStore.postFinding(
        id,
        projectId,
        (msg.payload?.taskId as string) || "",
        (msg.payload?.sessionId as string) || "",
        (msg.payload?.category as string) || "general",
        title,
        (msg.payload?.content as string) || "",
        (msg.payload?.tags as string[]) || [],
      );
      sendWs(ws, { type: "finding_posted", payload: { id, projectId } });
      break;
    }

    // ─── Diff ──────────────────────────────────────────────

    case "get_task_diff": {
      const taskId = msg.payload?.taskId as string;
      if (!taskId) return;

      const task = taskStore.getTask(taskId);
      if (!task || !task.branch) {
        sendWs(ws, {
          type: "task_diff",
          payload: { taskId, error: "No branch" },
        });
        return;
      }

      const environmentId =
        task.environmentId ||
        projectStore.getProject(task.projectId)?.defaultEnvironmentId;
      if (!environmentId) {
        sendWs(ws, {
          type: "task_diff",
          payload: { taskId, error: "No environment" },
        });
        return;
      }

      const conn = adapterManager.getConnection(environmentId);
      if (!conn) {
        sendWs(ws, {
          type: "task_diff",
          payload: { taskId, error: "Environment not connected" },
        });
        return;
      }

      try {
        const diffResp = await conn.client.getDiff(
          create(powerline.DiffRequestSchema, {
            branch: task.branch,
            baseBranch: "main",
            worktreeBasePath: "/workspace",
          }),
        );
        sendWs(ws, {
          type: "task_diff",
          payload: {
            taskId,
            branch: task.branch,
            diff: diffResp.diff,
            changedFiles: [...diffResp.changedFiles],
            additions: diffResp.additions,
            deletions: diffResp.deletions,
          },
        });
      } catch (err) {
        sendWs(ws, {
          type: "task_diff",
          payload: { taskId, error: String(err) },
        });
      }
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
      broadcastEnvironments();

      // Run provision in background, broadcasting progress to all connected clients
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (async () => {
        try {
          const config = safeParseAdapterConfig(
            env.adapterConfig,
            environmentId,
          );
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
            broadcast({
              type: "provision_progress",
              payload: {
                environmentId,
                stage: event.stage,
                message: event.message,
                progress: event.progress,
              },
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
          broadcast({
            type: "provision_progress",
            payload: {
              environmentId,
              stage: "ready",
              message: "Environment connected",
              progress: 1,
            },
          });
        } catch (err) {
          logger.error({ environmentId, err }, "Provision failed");
          envRegistry.updateEnvironmentStatus(environmentId, "error");
          const errorMessage = err instanceof Error ? err.message : String(err);
          broadcast({
            type: "provision_progress",
            payload: {
              environmentId,
              stage: "error",
              message: `Connection failed: ${errorMessage}`,
              progress: 0,
            },
          });
        }
        broadcastEnvironments();
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
      broadcastEnvironments();
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
      const defaultRuntime =
        (msg.payload?.defaultRuntime as string) || DEFAULT_RUNTIME;
      envRegistry.addEnvironment(
        id,
        displayName,
        adapterType,
        adapterConfig,
        defaultRuntime,
      );
      logger.info(
        { id, displayName, adapterType },
        "Environment added via WebSocket",
      );
      broadcast({ type: "environment_added", payload: { environmentId: id } });
      broadcastEnvironments();
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
      broadcast({ type: "environment_removed", payload: { environmentId } });
      broadcastEnvironments();
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
          payload: { codespaces: [], error: String(err) },
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
      try {
        const result = await exec(
          "gh",
          [
            "codespace",
            "create",
            "--repo",
            trimmedRepo,
            "--machine",
            "basicLinux32gb",
          ],
          { timeout: GH_CODESPACE_CREATE_TIMEOUT_MS },
        );
        const codespaceName = result.stdout.trim();
        sendWs(ws, {
          type: "codespace_created",
          payload: { name: codespaceName, repository: trimmedRepo },
        });
      } catch (err) {
        logger.error({ err, repo }, "Failed to create codespace");
        sendWs(ws, {
          type: "codespace_create_error",
          payload: { message: String(err) },
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
      broadcast({ type: "token_changed" });
      break;
    }

    case "delete_token": {
      const tokenName = msg.payload?.name as string;
      if (!tokenName) {
        sendWs(ws, { type: "error", payload: { message: "name required" } });
        return;
      }
      await tokenBroker.deleteToken(tokenName);
      broadcast({ type: "token_changed" });
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
