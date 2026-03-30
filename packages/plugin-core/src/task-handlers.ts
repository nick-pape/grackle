import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import type { PipeMode } from "@grackle-ai/common";
import {
  DEFAULT_MCP_PORT,
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  type SessionStatus,
  END_REASON,
  TASK_STATUS,
  ROOT_TASK_ID,
  ROOT_TASK_INITIAL_PROMPT,
  MAX_TASK_DEPTH,
  LOGS_DIR,
  taskStatusToString,
} from "@grackle-ai/common";
import { envRegistry, sessionStore, taskStore, workspaceStore, personaStore, settingsStore, dispatchQueueStore, grackleHome, slugify, safeParseJsonArray } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { join } from "node:path";
import { adapterManager } from "@grackle-ai/core";
import { streamHub } from "@grackle-ai/core";
import { streamRegistry } from "@grackle-ai/core";
import { tokenPush } from "@grackle-ai/core";
import { emit } from "@grackle-ai/core";
import { processEventStream } from "@grackle-ai/core";
import { processorRegistry } from "@grackle-ai/core";
import { logger } from "@grackle-ai/core";
import { getTraceId } from "@grackle-ai/core";
import { resolvePersona, buildOrchestratorContext, SystemPromptBuilder, buildTaskPrompt } from "@grackle-ai/prompt";
import { toPersonaResolveInput, buildOrchestratorContextInput } from "./persona-mapper.js";
import { createScopedToken, loadOrCreateApiKey } from "@grackle-ai/auth";
import { cleanupLifecycleStream, ensureLifecycleStream } from "./lifecycle.js";
import { ensureAsyncDeliveryListener } from "@grackle-ai/core";
import { ensureStdinStream } from "@grackle-ai/core";
import { computeTaskStatus } from "@grackle-ai/core";
import { transferAllPipeSubscriptions } from "./signals/orphan-reparent.js";
import { taskRowToProto, sessionRowToProto } from "./grpc-proto-converters.js";
import { validatePipeInputs, toDialableHost, resolveAncestorEnvironmentId } from "./grpc-shared.js";
import { personaMcpServersToJson } from "./grpc-mcp-config.js";
import { hasCapacity, type ConcurrencyDeps, checkBudget } from "@grackle-ai/core";

/** List tasks, optionally filtered by workspace, search query, or status. */
export async function listTasks(req: grackle.ListTasksRequest): Promise<grackle.TaskList> {
  const rows = taskStore.listTasks(req.workspaceId || undefined, {
    search: req.search || undefined,
    status: req.status || undefined,
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

  return create(grackle.TaskListSchema, {
    tasks: rows.map((r) => {
      const taskSessions = sessionsByTask.get(r.id) ?? [];
      const { status, latestSessionId } = computeTaskStatus(r.status, taskSessions);
      return taskRowToProto(r, childIdsMap.get(r.id) ?? [], status, latestSessionId);
    }),
  });
}

/** Create a new task. */
export async function createTask(req: grackle.CreateTaskRequest): Promise<grackle.Task> {
  if (!req.title) {
    throw new ConnectError("title is required", Code.InvalidArgument);
  }
  const workspaceId = req.workspaceId || undefined;
  let workspace: ReturnType<typeof workspaceStore.getWorkspace>;
  if (workspaceId) {
    workspace = workspaceStore.getWorkspace(workspaceId);
    if (!workspace) {
      throw new ConnectError(`Workspace not found: ${workspaceId}`, Code.NotFound);
    }
  }

  // Validate parent task if specified
  if (req.parentTaskId) {
    const parent = taskStore.getTask(req.parentTaskId);
    if (!parent) {
      throw new ConnectError(`Parent task not found: ${req.parentTaskId}`, Code.NotFound);
    }
    if (!parent.canDecompose) {
      throw new ConnectError(
        `Parent task "${parent.title}" (${req.parentTaskId}) does not have decomposition rights`,
        Code.FailedPrecondition,
      );
    }
    if (parent.depth + 1 > MAX_TASK_DEPTH) {
      throw new ConnectError(
        `Task depth would exceed maximum of ${MAX_TASK_DEPTH}`,
        Code.FailedPrecondition,
      );
    }
  }

  if ((req.tokenBudget ?? 0) < 0 || (req.costBudgetMillicents ?? 0) < 0) {
    throw new ConnectError("Budget values must be >= 0", Code.InvalidArgument);
  }

  const id = uuid().slice(0, 8);
  taskStore.createTask(
    id,
    workspaceId,
    req.title,
    req.description,
    [...req.dependsOn],
    workspace ? slugify(workspace.name) : "",
    req.parentTaskId,
    // Default to false (no decomposition rights) unless explicitly granted.
    // Orchestrator/root processes that need fork() must opt in.
    req.canDecompose ?? false,
    req.defaultPersonaId ?? "",
    req.tokenBudget ?? 0,
    req.costBudgetMillicents ?? 0,
  );
  const row = taskStore.getTask(id);
  emit("task.created", { taskId: id, workspaceId: req.workspaceId });
  logger.info({ taskId: id, workspaceId: req.workspaceId }, "Task created");
  return taskRowToProto(row!);
}

/** Get a task by ID with computed status. */
export async function getTask(req: grackle.TaskId): Promise<grackle.Task> {
  const row = taskStore.getTask(req.id);
  if (!row) {
    throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);
  }
  const taskSessions = sessionStore.listSessionsForTask(req.id);
  const { status, latestSessionId } = computeTaskStatus(row.status, taskSessions);
  return taskRowToProto(row, undefined, status, latestSessionId);
}

/** Update task fields or late-bind a session to a task. */
export async function updateTask(req: grackle.UpdateTaskRequest): Promise<grackle.Task> {
  const existing = taskStore.getTask(req.id);
  if (!existing) {
    throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);
  }

  let reqStatus = existing.status;
  if (req.status !== grackle.TaskStatus.UNSPECIFIED) {
    if (req.id === ROOT_TASK_ID) {
      throw new ConnectError("Cannot change the status of the system task", Code.PermissionDenied);
    }
    const converted = taskStatusToString(req.status);
    if (!converted) {
      throw new ConnectError(`Unknown task status enum value: ${req.status}`, Code.InvalidArgument);
    }
    reqStatus = converted;
  }

  taskStore.updateTask(
    req.id,
    req.title !== "" ? req.title : existing.title,
    req.description !== "" ? req.description : existing.description,
    reqStatus,
    req.dependsOn.length > 0
      ? [...req.dependsOn]
      : safeParseJsonArray(existing.dependsOn),
    req.defaultPersonaId,
  );

  // Update budget fields if explicitly set in the request (proto3 optional presence)
  if ((req.tokenBudget !== undefined && req.tokenBudget < 0) || (req.costBudgetMillicents !== undefined && req.costBudgetMillicents < 0)) {
    throw new ConnectError("Budget values must be >= 0", Code.InvalidArgument);
  }
  if (req.tokenBudget !== undefined || req.costBudgetMillicents !== undefined) {
    taskStore.updateTaskBudget(
      req.id,
      req.tokenBudget ?? existing.tokenBudget,
      req.costBudgetMillicents ?? existing.costBudgetMillicents,
    );
  }

  // Late-bind: associate an existing session with this task
  if (req.sessionId !== "") {
    const session = sessionStore.getSession(req.sessionId);
    if (!session) {
      throw new ConnectError(`Session not found: ${req.sessionId}`, Code.NotFound);
    }
    if (TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
      throw new ConnectError(
        `Cannot bind terminal session ${req.sessionId} (status: ${session.status})`,
        Code.FailedPrecondition,
      );
    }

    // Verify the processor exists before mutating DB state to avoid partial updates
    if (!processorRegistry.get(req.sessionId)) {
      throw new ConnectError(
        `No active event processor for session ${req.sessionId}`,
        Code.FailedPrecondition,
      );
    }

    sessionStore.setSessionTask(req.sessionId, req.id);
    processorRegistry.lateBind(req.sessionId, req.id, existing.workspaceId || undefined);
    emit("task.started", { taskId: req.id, sessionId: req.sessionId, workspaceId: existing.workspaceId || "" });
  }

  emit("task.updated", { taskId: req.id, workspaceId: existing.workspaceId || "" });
  logger.info({ taskId: req.id }, "Task updated");

  const row = taskStore.getTask(req.id);
  const taskSessions = sessionStore.listSessionsForTask(req.id);
  const { status, latestSessionId } = computeTaskStatus(row!.status, taskSessions);
  return taskRowToProto(row!, undefined, status, latestSessionId);
}

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
    } else if (!([TASK_STATUS.NOT_STARTED, TASK_STATUS.FAILED] as string[]).includes(effectiveStatus)) {
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

  const environmentId = req.environmentId
    || resolveAncestorEnvironmentId(task.parentTaskId)
    || workspace?.environmentId
    || "";
  if (!environmentId) {
    throw new ConnectError("No environment specified for task, ancestor, or workspace", Code.FailedPrecondition);
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
      (id) => toPersonaResolveInput(personaStore.getPersona(id)),
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
      throw new ConnectError("Environment at capacity; task queued for dispatch", Code.ResourceExhausted);
    }

    // If this task was previously enqueued but we now have capacity,
    // remove the stale queue entry to prevent duplicate dispatch.
    dispatchQueueStore.dequeue(task.id);
  }

  const env = envRegistry.getEnvironment(environmentId);
  const sessionId = uuid();
  const { runtime, model, maxTurns, systemPrompt } = resolved;
  const logPath = join(grackleHome, LOGS_DIR, sessionId);

  // Root task always starts with the hardcoded greeting prompt; user messages
  // are sent as follow-ups via sendInput.  Other tasks use buildTaskPrompt.
  const taskPrompt = task.id === ROOT_TASK_ID
    ? ROOT_TASK_INITIAL_PROMPT
    : buildTaskPrompt(task.title, task.description, req.notes);
  const isOrchestrator = task.canDecompose && task.depth <= 1 && !!task.workspaceId;
  const orchestratorCtx = isOrchestrator
    ? buildOrchestratorContext(buildOrchestratorContextInput(
      task.workspaceId!,
      workspace ? { name: workspace.name, description: workspace.description, repoUrl: workspace.repoUrl } : undefined,
    ))
    : undefined;

  const systemContext = new SystemPromptBuilder({
    task: { title: task.title, description: task.description, notes: task.id === ROOT_TASK_ID ? "" : (req.notes || "") },
    taskId: task.id,
    canDecompose: task.canDecompose,
    personaPrompt: systemPrompt,
    taskDepth: task.depth,
    workpad: task.workpad || undefined,
    ...orchestratorCtx,
    ...(orchestratorCtx && { triggerMode: "fresh" as const }),
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
    req.parentSessionId || "",  // parentSessionId
    taskPipeMode || "",         // pipeMode
  );
  emit("task.started", { taskId: task.id, sessionId, workspaceId: task.workspaceId || "" });

  // Re-push stored tokens + provider credentials (scoped to runtime) so they're fresh for this session.
  // For local envs, skip file tokens — the PowerLine is on the same machine.
  await tokenPush.refreshTokensForTask(environmentId, runtime,
    env?.adapterType === "local" ? { excludeFileTokens: true } : undefined);

  const mcpServersJson = personaMcpServersToJson(resolved.mcpServers, resolved.personaId);

  const useWorktrees = workspace?.useWorktrees ?? false;
  if (!useWorktrees) {
    logger.warn(
      { taskId: task.id, workspaceId: task.workspaceId, branch: task.branch },
      "Worktrees disabled for workspace — agent will work in main checkout. Concurrent tasks on the same environment may conflict.",
    );
  }

  const taskMcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const taskMcpDialHost = toDialableHost(process.env.GRACKLE_HOST || "127.0.0.1");
  const taskMcpUrl = `http://${taskMcpDialHost}:${taskMcpPort}/mcp`;
  const taskMcpToken = createScopedToken(
    { sub: task.id, pid: task.workspaceId || "", per: resolved.personaId, sid: sessionId },
    loadOrCreateApiKey(grackleHome),
  );

  const powerlineReq = create(powerline.SpawnRequestSchema, {
    sessionId,
    runtime,
    prompt: taskPrompt,
    model,
    maxTurns,
    branch: task.branch,
    workingDirectory: task.branch
      ? (workspace?.workingDirectory || process.env.GRACKLE_WORKTREE_BASE || "/workspace")
      : "",
    useWorktrees,
    systemContext,
    workspaceId: task.workspaceId ?? undefined,
    taskId: task.id,
    mcpServersJson,
    mcpUrl: taskMcpUrl,
    mcpToken: taskMcpToken,
    scriptContent: resolved.type === "script" ? resolved.script : "",
    pipe: req.pipe,
  });

  // Create lifecycle stream for the task session
  const taskLifecycleStream = streamRegistry.createStream(`lifecycle:${sessionId}`);
  const taskSpawnerId = req.parentSessionId || "__server__";
  streamRegistry.subscribe(taskLifecycleStream.id, taskSpawnerId, "rw", "detach", true);
  streamRegistry.subscribe(taskLifecycleStream.id, sessionId, "rw", "detach", false);

  // Create stdin stream — routes human input through the stream-registry
  ensureStdinStream(sessionId);

  // Set up IPC pipe stream (optional)
  let taskPipeFd = 0;
  if (taskPipeMode && taskPipeMode !== "detach" && req.parentSessionId) {
    const ipcStream = streamRegistry.createStream(`pipe:${sessionId}`);
    const parentSub = streamRegistry.subscribe(
      ipcStream.id, req.parentSessionId, "rw",
      taskPipeMode === "sync" ? "sync" : "async",
      true,
    );
    streamRegistry.subscribe(
      ipcStream.id, sessionId, "rw", "async",
      false,
    );
    taskPipeFd = parentSub.fd;

    if (taskPipeMode === "async") {
      ensureAsyncDeliveryListener(req.parentSessionId);  // parent receives child messages
      ensureAsyncDeliveryListener(sessionId);             // child receives parent messages
    }
  }

  processEventStream(conn.client.spawn(powerlineReq), {
    sessionId,
    logPath,
    workspaceId: task.workspaceId ?? undefined,
    taskId: task.id,
    systemContext,
    prompt: taskPrompt,
    traceId: getTraceId(),
  });

  logger.info({ taskId: task.id, sessionId, workspaceId: task.workspaceId }, "Task started");

  const row = sessionStore.getSession(sessionId);
  const taskProto = sessionRowToProto(row!);
  taskProto.pipeFd = taskPipeFd;
  return taskProto;
}

/** Mark a task as complete and clean up active sessions. */
export async function completeTask(req: grackle.TaskId): Promise<grackle.Task> {
  if (req.id === ROOT_TASK_ID) {
    throw new ConnectError("Cannot complete the system task", Code.PermissionDenied);
  }
  const task = taskStore.getTask(req.id);
  if (!task) {
    throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);
  }

  taskStore.markTaskComplete(task.id, TASK_STATUS.COMPLETE);

  // Transfer ALL pipe fds from this task's sessions to the grandparent BEFORE
  // closing sessions — once sessions are cleaned up, their subscriptions are gone.
  // Always transfer regardless of orphaned tasks: ipc_spawn creates child sessions
  // (not tasks), so pipe subs exist even when getOrphanedTasks returns empty.
  const grandparentId = task.parentTaskId || ROOT_TASK_ID;
  transferAllPipeSubscriptions(task.id, grandparentId);

  // Close lifecycle FDs for any active sessions — cascades to STOPPED via orphan callback
  const activeSessions = sessionStore.getActiveSessionsForTask(req.id);
  for (const activeSession of activeSessions) {
    cleanupLifecycleStream(activeSession.id);
    const subs = streamRegistry.getSubscriptionsForSession(activeSession.id);
    for (const sub of subs) {
      streamRegistry.unsubscribe(sub.id);
    }
  }

  // Check for newly unblocked tasks
  if (task.workspaceId) {
    const unblocked = taskStore.checkAndUnblock(task.workspaceId);
    for (const t of unblocked) {
      streamHub.publish(
        create(grackle.SessionEventSchema, {
          sessionId: "",
          type: grackle.EventType.SYSTEM,
          timestamp: new Date().toISOString(),
          content: JSON.stringify({
            type: "task_unblocked",
            taskId: t.id,
            title: t.title,
          }),
          raw: "",
        }),
      );
    }
  }

  emit("task.completed", { taskId: task.id, workspaceId: task.workspaceId || "" });
  logger.info({ taskId: task.id }, "Task completed");
  const row = taskStore.getTask(task.id);
  const taskSessions = sessionStore.listSessionsForTask(task.id);
  const { status, latestSessionId } = computeTaskStatus(row!.status, taskSessions);
  return taskRowToProto(row!, undefined, status, latestSessionId);
}

/** Set the workpad JSON for a task. */
export async function setWorkpad(req: grackle.SetWorkpadRequest): Promise<grackle.Task> {
  const task = taskStore.getTask(req.taskId);
  if (!task) {
    throw new ConnectError(`Task not found: ${req.taskId}`, Code.NotFound);
  }
  // Validate workpad is a valid JSON object
  try {
    const parsed: unknown = JSON.parse(req.workpad);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConnectError("Workpad must be a JSON object", Code.InvalidArgument);
    }
  } catch (err) {
    if (err instanceof ConnectError) {
      throw err;
    }
    throw new ConnectError("Workpad must be valid JSON", Code.InvalidArgument);
  }
  const MAX_WORKPAD_BYTES = 64 * 1024; // 64 KB
  const workpadBytes = Buffer.byteLength(req.workpad, "utf8");
  if (workpadBytes > MAX_WORKPAD_BYTES) {
    throw new ConnectError(`Workpad exceeds maximum size of ${MAX_WORKPAD_BYTES} bytes`, Code.InvalidArgument);
  }
  taskStore.setWorkpad(req.taskId, req.workpad);
  const row = taskStore.getTask(req.taskId)!;
  const taskSessions = sessionStore.listSessionsForTask(req.taskId);
  const { status, latestSessionId } = computeTaskStatus(row.status, taskSessions);
  return taskRowToProto(row, undefined, status, latestSessionId);
}

/** Resume the latest session for a task. */
export async function resumeTask(req: grackle.TaskId): Promise<grackle.Session> {
  const task = taskStore.getTask(req.id);
  if (!task) {
    throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);
  }

  const latestSession = sessionStore.getLatestSessionForTask(req.id);
  if (!latestSession) {
    throw new ConnectError(`Task ${req.id} has no sessions to resume`, Code.FailedPrecondition);
  }
  if (!([SESSION_STATUS.STOPPED, SESSION_STATUS.SUSPENDED] as string[]).includes(latestSession.status)) {
    throw new ConnectError(
      `Latest session ${latestSession.id} is not resumable (status: ${latestSession.status})`,
      Code.FailedPrecondition,
    );
  }
  if (!latestSession.runtimeSessionId) {
    throw new ConnectError(
      `Latest session ${latestSession.id} has no runtime session ID — cannot resume`,
      Code.FailedPrecondition,
    );
  }

  const conn = adapterManager.getConnection(latestSession.environmentId);
  if (!conn) {
    throw new ConnectError(`Environment ${latestSession.environmentId} not connected`, Code.FailedPrecondition);
  }

  const powerlineReq = create(powerline.ResumeRequestSchema, {
    sessionId: latestSession.id,
    runtimeSessionId: latestSession.runtimeSessionId,
    runtime: latestSession.runtime,
  });

  const logPath =
    latestSession.logPath || join(grackleHome, LOGS_DIR, latestSession.id);

  // Initiate the stream before mutating the DB. If resume() throws
  // synchronously the DB is never touched, so no rollback is needed.
  const resumeStream = conn.client.resume(powerlineReq);

  // Reset session DB row to RUNNING (clears endedAt, error, etc.)
  sessionStore.reanimateSession(latestSession.id);

  // Re-create lifecycle stream if it was deleted during kill/stop
  const resumeSpawnerId = latestSession.parentSessionId || "__server__";
  ensureLifecycleStream(latestSession.id, resumeSpawnerId);

  processEventStream(resumeStream, {
    sessionId: latestSession.id,
    logPath,
    workspaceId: task.workspaceId ?? undefined,
    taskId: task.id,
    traceId: getTraceId(),
  });

  emit("task.started", { taskId: task.id, sessionId: latestSession.id, workspaceId: task.workspaceId || "" });
  logger.info({ taskId: task.id, sessionId: latestSession.id }, "Task resumed");

  const row = sessionStore.getSession(latestSession.id);
  return sessionRowToProto(row!);
}

/** Stop a task by terminating all its active sessions. */
export async function stopTask(req: grackle.TaskId): Promise<grackle.Task> {
  const task = taskStore.getTask(req.id);
  if (!task) {
    throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);
  }

  // Terminate all active sessions for this task using the fd-closure pattern
  const activeSessions = sessionStore.getActiveSessionsForTask(req.id);
  for (const activeSession of activeSessions) {
    cleanupLifecycleStream(activeSession.id);
    const subs = streamRegistry.getSubscriptionsForSession(activeSession.id);
    for (const sub of subs) {
      streamRegistry.unsubscribe(sub.id);
    }
    const current = sessionStore.getSession(activeSession.id);
    if (current && !TERMINAL_SESSION_STATUSES.has(current.status as SessionStatus)) {
      sessionStore.updateSession(activeSession.id, SESSION_STATUS.STOPPED, undefined, undefined, END_REASON.INTERRUPTED);
      streamHub.publish(
        create(grackle.SessionEventSchema, {
          sessionId: activeSession.id,
          type: grackle.EventType.STATUS,
          timestamp: new Date().toISOString(),
          content: END_REASON.INTERRUPTED,
          raw: "",
        }),
      );
    }
  }

  // Mark task complete
  taskStore.markTaskComplete(req.id, TASK_STATUS.COMPLETE);

  // Check for newly unblocked tasks
  if (task.workspaceId) {
    taskStore.checkAndUnblock(task.workspaceId);
  }

  emit("task.completed", { taskId: task.id, workspaceId: task.workspaceId || "" });
  logger.info({ taskId: req.id }, "Task stopped");
  const updated = taskStore.getTask(req.id);
  const taskSessions = sessionStore.listSessionsForTask(req.id);
  const { status, latestSessionId } = computeTaskStatus(updated!.status, taskSessions);
  return taskRowToProto(updated!, undefined, status, latestSessionId);
}

/** Delete a task and all its sessions. */
export async function deleteTask(req: grackle.TaskId): Promise<grackle.Empty> {
  if (req.id === ROOT_TASK_ID) {
    throw new ConnectError("Cannot delete the system task", Code.PermissionDenied);
  }
  const task = taskStore.getTask(req.id);
  if (!task) {
    throw new ConnectError(`Task not found: ${req.id}`, Code.NotFound);
  }
  const children = taskStore.getChildren(req.id);
  if (children.length > 0) {
    throw new ConnectError(
      "Cannot delete task with children. Delete children first.",
      Code.FailedPrecondition,
    );
  }

  // Terminate all active sessions via lifecycle cleanup before deleting the task
  const activeSessions = sessionStore.getActiveSessionsForTask(req.id);
  for (const activeSession of activeSessions) {
    cleanupLifecycleStream(activeSession.id);
    const subs = streamRegistry.getSubscriptionsForSession(activeSession.id);
    for (const sub of subs) {
      streamRegistry.unsubscribe(sub.id);
    }
  }

  const changes = taskStore.deleteTask(req.id);
  if (changes === 0) {
    logger.error({ taskId: req.id }, "deleteTask returned 0 changes despite task existing");
    throw new ConnectError(
      `Failed to delete task ${req.id}: no rows affected`,
      Code.Internal,
    );
  }
  emit("task.deleted", { taskId: req.id, workspaceId: task.workspaceId || "" });
  logger.info({ taskId: req.id }, "Task deleted");
  return create(grackle.EmptySchema, {});
}
