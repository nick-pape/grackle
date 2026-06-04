/** Task start handler extracted from task-handlers.ts (#1470). @module */
import { ConnectError, Code } from "@connectrpc/connect";
import { grackle } from "@grackle-ai/common";
import type { PipeMode } from "@grackle-ai/common";
import { TASK_STATUS, ROOT_TASK_ID, ROOT_TASK_INITIAL_PROMPT, LOGS_DIR } from "@grackle-ai/common";
import {
  envRegistry,
  sessionStore,
  taskStore,
  workspaceStore,
  personaStore,
  settingsStore,
  dispatchQueueStore,
  grackleHome,
  workspaceEnvironmentLinkStore,
} from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { join } from "node:path";
import { adapterManager } from "@grackle-ai/core";
import { tokenPush } from "@grackle-ai/core";
import { emit } from "@grackle-ai/core";
import { logger } from "@grackle-ai/core";
import { getTraceId } from "@grackle-ai/core";
import { computeTaskStatus } from "@grackle-ai/core";
import { toPersonaResolveInput, buildOrchestratorContextInput } from "@grackle-ai/core";
import { buildMcpServersJson, toPersonaModel } from "@grackle-ai/core";
import { hasCapacity, type ConcurrencyDeps, checkBudget } from "@grackle-ai/core";
import { hasSpawnContextProviders, runSpawnContextProviders } from "@grackle-ai/core";
import {
  resolveSpawnSpec,
  personaToLayer,
  workspaceToLayer,
  taskToLayer,
  hostDefaults,
} from "@grackle-ai/core";
import {
  resolvePersona,
  buildOrchestratorContext,
  SystemPromptBuilder,
  buildTaskPrompt,
} from "@grackle-ai/prompt";
import { createScopedToken, loadOrCreateApiKey } from "@grackle-ai/auth";
import { validatePipeInputs, resolveAncestorEnvironmentId } from "./grpc-shared.js";
import { buildCreateSessionParams } from "./spawn-request.js";
import { buildMcpUrl, executeSpawnTail } from "./spawn-orchestration.js";

/** Start a task by spawning a new agent session. */
export async function startTask(req: grackle.StartTaskRequest): Promise<grackle.Session> {
  const task = taskStore.getTask(req.taskId);
  if (!task) {
    throw new ConnectError(`Task not found: ${req.taskId}`, Code.NotFound);
  }
  {
    const taskSessions = sessionStore.listSessionsForTask(req.taskId);
    const { status: effectiveStatus } = computeTaskStatus(task.status, taskSessions);
    if (req.taskId === ROOT_TASK_ID) {
      // Root task is always re-startable unless actively working
      if (effectiveStatus === TASK_STATUS.WORKING) {
        throw new ConnectError("System is already running", Code.FailedPrecondition);
      }
    } else if (
      !([TASK_STATUS.NOT_STARTED, TASK_STATUS.FAILED] as string[]).includes(effectiveStatus)
    ) {
      throw new ConnectError(
        `Task ${req.taskId} cannot be started (status: ${effectiveStatus})`,
        Code.FailedPrecondition,
      );
    }
  }
  if (!taskStore.areDependenciesMet(req.taskId)) {
    throw new ConnectError(`Task ${req.taskId} has unmet dependencies`, Code.FailedPrecondition);
  }

  // ── Pre-spawn budget check ──
  const budgetResult = checkBudget(req.taskId, task.workspaceId || undefined);
  if (budgetResult) {
    throw new ConnectError(
      `Budget exceeded (${budgetResult.scope} ${budgetResult.reason}): ${budgetResult.message}`,
      Code.ResourceExhausted,
    );
  }

  const workspace = task.workspaceId ? workspaceStore.getWorkspace(task.workspaceId) : undefined;
  if (task.workspaceId && !workspace) {
    throw new ConnectError(`Workspace not found: ${task.workspaceId}`, Code.NotFound);
  }

  const environmentId =
    req.environmentId ||
    resolveAncestorEnvironmentId(task.parentTaskId) ||
    (task.workspaceId
      ? workspaceEnvironmentLinkStore.getLinkedEnvironmentIds(task.workspaceId)[0]
      : "") ||
    "";
  if (!environmentId) {
    throw new ConnectError(
      "No environment specified for task, ancestor, or workspace",
      Code.FailedPrecondition,
    );
  }

  const conn = adapterManager.getConnection(environmentId);
  if (!conn) {
    throw new ConnectError(`Environment ${environmentId} not connected`, Code.FailedPrecondition);
  }

  // Resolve persona via cascade (request → task → workspace → app default)
  let resolved: ReturnType<typeof resolvePersona>;
  try {
    resolved = resolvePersona(
      req.personaId,
      task.defaultPersonaId,
      workspace?.defaultPersonaId || "",
      settingsStore.getSetting("default_persona_id") || undefined,
      (id) => {
        const row = personaStore.getPersona(id);
        return row ? toPersonaResolveInput(toPersonaModel(row)) : undefined;
      },
    );
  } catch (err) {
    throw new ConnectError((err as Error).message, Code.FailedPrecondition);
  }

  // Validate pipe inputs before creating the session
  validatePipeInputs(req.pipe, req.parentSessionId);
  const taskPipeMode = req.pipe as PipeMode;

  // ── Concurrency gate (hybrid fast-path) ──────────────────
  // Pipe-mode tasks bypass the queue because the parent agent is waiting
  // synchronously for the child session to start.
  if (!taskPipeMode) {
    const concurrencyDeps: ConcurrencyDeps = {
      countActiveForEnvironment: sessionStore.countActiveForEnvironment,
      getEnvironment: (id) => envRegistry.getEnvironment(id),
      getSetting: settingsStore.getSetting,
    };
    if (!hasCapacity(environmentId, concurrencyDeps)) {
      dispatchQueueStore.enqueue({
        id: uuid(),
        taskId: task.id,
        environmentId,
        personaId: resolved.personaId,
        notes: req.notes || "",
      });
      logger.info({ taskId: task.id, environmentId }, "Task queued (environment at capacity)");
      throw new ConnectError(
        "Environment at capacity; task queued for dispatch",
        Code.ResourceExhausted,
      );
    }

    // If this task was previously enqueued but we now have capacity,
    // remove the stale queue entry to prevent duplicate dispatch.
    dispatchQueueStore.dequeue(task.id);
  }

  const env = envRegistry.getEnvironment(environmentId);
  const sessionId = uuid();

  // Unified spawn-config cascade (#1427): host → persona → workspace → task.
  // startTask has no scalar spawnOverride layer (no provider/model/maxTurns
  // overrides on the request); per-task overrides land here once #1418's
  // follow-up makes Agents/Tasks config-bearing.
  const spec = resolveSpawnSpec({
    host: hostDefaults(),
    persona: personaToLayer(resolved),
    workspace: workspace ? workspaceToLayer(workspace) : undefined,
    task: taskToLayer({}),
  });
  const { runtime, model, maxTurns } = spec;
  const { systemPrompt } = resolved;
  const logPath = join(grackleHome, LOGS_DIR, sessionId);

  // Supply credentials on demand for this runtime, just before spawn (AHP HR6).
  // For local envs, skip file tokens — the PowerLine is on the same machine.
  // Runs a fail-fast pre-flight (#1316): a required-but-missing/expired credential
  // throws here, before the (expensive) knowledge retrieval below and before any
  // session row is created or "task.started" emitted.
  await tokenPush.authenticateForRuntime(
    environmentId,
    runtime,
    env?.adapterType === "local" ? { excludeFileTokens: true } : undefined,
  );

  // Root task always starts with the hardcoded greeting prompt; user messages
  // are sent as follow-ups via sendInput.  Other tasks use buildTaskPrompt.
  const taskPrompt =
    task.id === ROOT_TASK_ID
      ? ROOT_TASK_INITIAL_PROMPT
      : buildTaskPrompt(task.title, task.description, req.notes);
  const isOrchestrator = task.canDecompose && task.depth <= 1 && !!task.workspaceId;
  const orchestratorCtx = isOrchestrator
    ? buildOrchestratorContext(
        buildOrchestratorContextInput(
          task.workspaceId!,
          workspace
            ? {
                name: workspace.name,
                description: workspace.description,
                repoUrl: workspace.repoUrl,
              }
            : undefined,
        ),
      )
    : undefined;

  // Knowledge retrieval loop (#1259): gather "Related prior work" (PUSH) + enable
  // search guidance (PULL) when the knowledge plugin is active and the task opted
  // in. Best-effort (timeout-bounded); skips root/no-workspace tasks.
  const knowledgeOn =
    hasSpawnContextProviders() &&
    task.injectKnowledge &&
    !!task.workspaceId &&
    task.id !== ROOT_TASK_ID;
  const relatedPriorWork = knowledgeOn
    ? (
        await runSpawnContextProviders({
          taskId: task.id,
          title: task.title,
          description: task.description,
          workspaceId: task.workspaceId ?? "",
          isOrchestrator,
          injectKnowledge: task.injectKnowledge,
        })
      ).join("\n\n") || undefined
    : undefined;

  const systemContext = new SystemPromptBuilder({
    task: {
      title: task.title,
      description: task.description,
      notes: task.id === ROOT_TASK_ID ? "" : req.notes || "",
    },
    taskId: task.id,
    canDecompose: task.canDecompose,
    personaPrompt: systemPrompt,
    taskDepth: task.depth,
    workpad: task.workpad || undefined,
    ...orchestratorCtx,
    ...(orchestratorCtx && { triggerMode: "fresh" as const }),
    relatedPriorWork,
    knowledgeGuidance: knowledgeOn,
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
    req.parentSessionId || "", // parentSessionId
    taskPipeMode || "", // pipeMode
  );
  emit("task.started", { taskId: task.id, sessionId, workspaceId: task.workspaceId || "" });

  const mcpServersJson =
    resolved.mcpServers.length > 0 ? buildMcpServersJson(resolved.mcpServers) : "";

  // Preserve the task-path's historical default of `false` when no workspace
  // expresses an opinion (e.g. root/schedule/channel tasks without a
  // workspaceId). The cascade itself is handled by resolveSpawnSpec above.
  const useWorktrees = spec.useWorktrees ?? false;
  if (!useWorktrees) {
    logger.warn(
      { taskId: task.id, workspaceId: task.workspaceId, branch: task.branch },
      "Worktrees disabled for workspace — agent will work in main checkout. Concurrent tasks on the same environment may conflict.",
    );
  }

  const taskMcpUrl = buildMcpUrl();
  const taskMcpToken = createScopedToken(
    {
      sub: task.id,
      pid: task.workspaceId || "",
      per: resolved.personaId,
      sid: sessionId,
      // #1418: tasks owned by an Agent carry the agent_id through to the
      // scoped token so MCP requests can be attributed to the principal.
      agt: task.agentId || undefined,
    },
    loadOrCreateApiKey(grackleHome),
  );

  const createParams = buildCreateSessionParams({
    sessionId,
    runtime,
    model,
    prompt: taskPrompt,
    maxTurns,
    config: undefined,
    systemContext,
    mcpServersJson,
    mcpUrl: taskMcpUrl,
    mcpToken: taskMcpToken,
    scriptContent: resolved.type === "script" ? resolved.script : "",
    workingDirectory: task.branch ? spec.workingDirectory : "",
    workspaceId: task.workspaceId ?? "",
    branch: task.branch,
    useWorktrees,
    taskId: task.id,
    pipe: req.pipe,
  });

  const { stream: spawnStream } = conn.transport.createSession(createParams);

  logger.info({ taskId: task.id, sessionId, workspaceId: task.workspaceId }, "Task started");

  return executeSpawnTail({
    sessionId,
    parentSessionId: req.parentSessionId || "",
    pipeMode: taskPipeMode,
    transportStream: spawnStream,
    eventContext: {
      sessionId,
      logPath,
      workspaceId: task.workspaceId ?? undefined,
      taskId: task.id,
      systemContext,
      prompt: taskPrompt,
      traceId: getTraceId(),
    },
  });
}
