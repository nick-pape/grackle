/**
 * Starts a new agent session for a task.
 *
 * Extracted from the former WebSocket bridge module. This is the non-gRPC
 * entry point used by the root-task auto-start flow and the cron scheduler.
 * The gRPC `StartTask` handler in `grpc-service.ts` has its own inline
 * implementation with additional validation and pipe support.
 *
 * @module
 */

import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";
import { envRegistry, sessionStore, workspaceStore, taskStore, personaStore, settingsStore, grackleHome } from "@grackle-ai/database";
import * as adapterManager from "./adapter-manager.js";
import * as tokenPush from "./token-push.js";
import { v4 as uuid } from "uuid";
import { join } from "node:path";
import {
  LOGS_DIR,
  DEFAULT_MCP_PORT,
  ROOT_TASK_ID,
} from "@grackle-ai/common";
import { resolvePersona, buildOrchestratorContext, SystemPromptBuilder, buildTaskPrompt } from "@grackle-ai/prompt";
import { logger } from "./logger.js";
import { processEventStream } from "./event-processor.js";
import { personaMcpServersToJson } from "./grpc-mcp-config.js";
import { toDialableHost } from "./grpc-shared.js";
import { emit } from "./event-bus.js";
import { createScopedToken, loadOrCreateApiKey } from "@grackle-ai/auth";
import { toPersonaResolveInput, buildOrchestratorContextInput } from "./persona-mapper.js";

/**
 * Start a new agent session for a task.
 *
 * Resolves the persona, creates a session record, pushes tokens, and spawns
 * the runtime on the environment's PowerLine connection. The environment must
 * already be connected — this function does not auto-provision.
 *
 * @returns An error message string on failure, `undefined` on success.
 */
export async function startTaskSession(
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

  const conn = adapterManager.getConnection(environmentId) ?? undefined;
  if (!conn) {
    return `Environment not connected: ${environmentId}`;
  }

  // Resolve persona via cascade (request → task → workspace → app default)
  let resolved;
  try {
    resolved = resolvePersona(
      options?.personaId || "",
      task.defaultPersonaId,
      workspace?.defaultPersonaId || "",
      settingsStore.getSetting("default_persona_id") || undefined,
      (id) => toPersonaResolveInput(personaStore.getPersona(id)),
    );
  } catch (err) {
    return (err as Error).message;
  }

  const sessionId = uuid();
  const { runtime, model, maxTurns, systemPrompt } = resolved;
  const logPath = join(grackleHome, LOGS_DIR, sessionId);

  const freshTask = taskStore.getTask(task.id) || task;
  // For the root/System task, use the user's chat message (passed as notes)
  // as the initial prompt instead of the task title "System".
  // For regular tasks, build the prompt from title + description.
  const taskPrompt = freshTask.id === ROOT_TASK_ID
    ? (options?.notes || "")
    : buildTaskPrompt(freshTask.title, freshTask.description, options?.notes);

  const orchestratorCtx = freshTask.canDecompose && freshTask.depth <= 1 && !!freshTask.workspaceId
    ? buildOrchestratorContext(buildOrchestratorContextInput(
      freshTask.workspaceId!,
      workspace ? { name: workspace.name, description: workspace.description, repoUrl: workspace.repoUrl } : undefined,
    ))
    : undefined;
  const systemContext = new SystemPromptBuilder({
    task: { title: freshTask.title, description: freshTask.description, notes: freshTask.id === ROOT_TASK_ID ? "" : (options?.notes || "") },
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
  await tokenPush.refreshTokensForTask(environmentId, runtime,
    env.adapterType === "local" ? { excludeFileTokens: true } : undefined);

  const mcpServersJson = personaMcpServersToJson(resolved.mcpServers, resolved.personaId);

  // Build MCP broker URL + scoped token so runtimes can call the MCP server.
  const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const mcpDialHost = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
  const mcpUrl = `http://${mcpDialHost}:${mcpPort}/mcp`;
  const mcpToken = createScopedToken(
    { sub: freshTask.id, pid: freshTask.workspaceId || "", per: resolved.personaId, sid: sessionId },
    loadOrCreateApiKey(grackleHome),
  );

  const useWorktrees = workspace?.useWorktrees ?? false;

  const powerlineReq = create(powerline.SpawnRequestSchema, {
    sessionId,
    runtime,
    prompt: taskPrompt,
    model,
    maxTurns,
    branch: freshTask.branch,
    workingDirectory: freshTask.branch
      ? (workspace?.workingDirectory || process.env.GRACKLE_WORKING_DIRECTORY || process.env.GRACKLE_WORKTREE_BASE || "/workspace")
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
