/**
 * Auto-starts the root task session on server boot.
 *
 * The root task is "process 1" — it must be running before any user
 * interaction. This module starts it once the local environment is
 * connected, using the same spawn machinery as regular task starts.
 */

import { v4 as uuid } from "uuid";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { ROOT_TASK_ID, LOGS_DIR, DEFAULT_MCP_PORT, powerline } from "@grackle-ai/common";
import * as taskStore from "./task-store.js";
import * as sessionStore from "./session-store.js";
import * as envRegistry from "./env-registry.js";
import * as adapterManager from "./adapter-manager.js";
import * as tokenBroker from "./token-broker.js";
import { resolvePersona } from "./resolve-persona.js";
import { SystemPromptBuilder, buildTaskPrompt } from "./system-prompt-builder.js";
import { buildMcpServersJson, toDialableHost } from "./grpc-service.js";
import { processEventStream } from "./event-processor.js";
import { emit } from "./event-bus.js";
import { grackleHome } from "./paths.js";
import { createScopedToken } from "@grackle-ai/mcp";
import { loadOrCreateApiKey } from "./api-key.js";
import { computeTaskStatus } from "./compute-task-status.js";
import { TASK_STATUS } from "@grackle-ai/common";
import { logger } from "./logger.js";

/**
 * Start the root task session if it is not already running.
 *
 * Called after the local environment connects during server boot.
 * Errors are logged but do not prevent the server from starting.
 */
export async function bootRootTask(environmentId: string): Promise<void> {
  const task = taskStore.getTask(ROOT_TASK_ID);
  if (!task) {
    logger.warn("Root task not found — skipping auto-start");
    return;
  }

  // Check if already running
  const taskSessions = sessionStore.listSessionsForTask(ROOT_TASK_ID);
  const { status } = computeTaskStatus(task.status, taskSessions);
  if (status === TASK_STATUS.WORKING) {
    logger.info("Root task already running — skipping auto-start");
    return;
  }

  const env = envRegistry.getEnvironment(environmentId);
  if (!env) {
    logger.warn({ environmentId }, "Root task auto-start: environment not found");
    return;
  }

  const conn = adapterManager.getConnection(environmentId);
  if (!conn) {
    logger.warn({ environmentId }, "Root task auto-start: environment not connected");
    return;
  }

  let resolved;
  try {
    resolved = resolvePersona("", task.defaultPersonaId, "");
  } catch (err) {
    logger.warn({ err }, "Root task auto-start: persona resolution failed");
    return;
  }

  const sessionId = uuid();
  const { runtime, model, maxTurns, systemPrompt, persona: resolvedPersonaRow } = resolved;
  const logPath = join(grackleHome, LOGS_DIR, sessionId);

  const taskPrompt = buildTaskPrompt(task.title, task.description);
  const systemContext = new SystemPromptBuilder({
    isTaskSession: true,
    canDecompose: task.canDecompose,
    personaPrompt: systemPrompt,
  }).build();

  sessionStore.createSession(
    sessionId,
    environmentId,
    runtime,
    task.title,
    model,
    logPath,
    task.id,
    resolved.personaId,
  );

  emit("task.started", {
    taskId: task.id,
    sessionId,
    workspaceId: task.workspaceId || "",
  });

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

  const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const mcpDialHost = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
  const mcpUrl = `http://${mcpDialHost}:${mcpPort}/mcp`;
  const mcpToken = createScopedToken(
    { sub: task.id, pid: task.workspaceId || "", per: resolved.personaId, sid: sessionId },
    loadOrCreateApiKey(),
  );

  const powerlineReq = create(powerline.SpawnRequestSchema, {
    sessionId,
    runtime,
    prompt: taskPrompt,
    model,
    maxTurns,
    branch: task.branch,
    worktreeBasePath: "",
    useWorktrees: false,
    systemContext,
    taskId: task.id,
    mcpServersJson,
    mcpUrl,
    mcpToken,
  });

  processEventStream(conn.client.spawn(powerlineReq), {
    sessionId,
    logPath,
    taskId: task.id,
    systemContext,
    prompt: taskPrompt,
  });

  logger.info({ sessionId, environmentId }, "Root task auto-started");
}
