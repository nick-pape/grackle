import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import {
  TERMINAL_SESSION_STATUSES,
  type SessionStatus,
  ROOT_TASK_ID,
  MAX_TASK_DEPTH,
  taskStatusToString,
  fuzzySearch,
  type FuzzyKey,
} from "@grackle-ai/common";
import type { WorkspaceRow } from "@grackle-ai/database";
import { sessionStore, taskStore, slugify, safeParseJsonArray } from "@grackle-ai/database";
import { v4 as uuid } from "uuid";
import { emit } from "@grackle-ai/core";
import { processorRegistry } from "@grackle-ai/core";
import { logger } from "@grackle-ai/core";
import { computeTaskStatus } from "@grackle-ai/core";
import { taskRowToProto } from "./grpc-proto-converters.js";
import {
  requireField,
  requireNonNegativeBudget,
  requireSession,
  requireTask,
  requireTrimmed,
  requireWorkspace,
} from "./require-helpers.js";

/** Weighted fields for fuzzy task search: title is twice as important as description. */
const TASK_SEARCH_KEYS: FuzzyKey[] = [
  { name: "title", weight: 2 },
  { name: "description", weight: 1 },
];

/** Default maximum number of results returned by searchTasks when limit is unset. */
const DEFAULT_SEARCH_LIMIT = 10;

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

/** Fuzzy search tasks by title and description, returning results ranked by relevance. */
export async function searchTasks(
  req: grackle.SearchTasksRequest,
): Promise<grackle.SearchTasksResponse> {
  const query = requireTrimmed(req.query, "query");
  const limit = req.limit > 0 ? req.limit : DEFAULT_SEARCH_LIMIT;

  // Fetch rows filtered by workspace/status at the DB level; fuzzy match happens in-memory
  const rows = taskStore.listTasks(req.workspaceId || undefined, {
    status: req.status ? req.status.toLowerCase() : undefined,
  });

  const fuzzyResults = fuzzySearch(rows, query, TASK_SEARCH_KEYS, { limit });

  // Build childIdsMap from ALL fetched rows so that parent tasks include their full child list
  // even when the children themselves are not among the fuzzy search results
  const childIdsMap = taskStore.buildChildIdsMap(rows);

  // Batch-fetch sessions for matched tasks and group by taskId
  const taskIds = fuzzyResults.map((r) => r.item.id);
  const allSessions = sessionStore.listSessionsByTaskIds(taskIds);
  const sessionsByTask = new Map<string, typeof allSessions>();
  for (const s of allSessions) {
    const arr = sessionsByTask.get(s.taskId) ?? [];
    arr.push(s);
    sessionsByTask.set(s.taskId, arr);
  }

  return create(grackle.SearchTasksResponseSchema, {
    results: fuzzyResults.map((r) => {
      const taskSessions = sessionsByTask.get(r.item.id) ?? [];
      const { status, latestSessionId } = computeTaskStatus(r.item.status, taskSessions);
      return create(grackle.SearchTaskResultSchema, {
        task: taskRowToProto(r.item, childIdsMap.get(r.item.id) ?? [], status, latestSessionId),
        relevanceScore: 1 - r.score, // invert fuse.js score: 1.0 = perfect match, 0.0 = no match
      });
    }),
  });
}

/** Create a new task. */
export async function createTask(req: grackle.CreateTaskRequest): Promise<grackle.Task> {
  requireField(req.title, "title");
  const workspaceId = req.workspaceId || undefined;
  let workspace: WorkspaceRow | undefined;
  if (workspaceId) {
    workspace = requireWorkspace(workspaceId);
  }

  // Validate parent task if specified
  if (req.parentTaskId) {
    const parent = requireTask(req.parentTaskId);
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

  requireNonNegativeBudget(req.tokenBudget, req.costBudgetMillicents);

  for (const depId of req.dependsOn) {
    requireTask(depId);
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
    // Knowledge context injection at spawn (#1259) defaults ON; opt out per task.
    req.injectKnowledge ?? true,
  );
  const row = taskStore.getTask(id);
  emit("task.created", { taskId: id, workspaceId: req.workspaceId });
  logger.info({ taskId: id, workspaceId: req.workspaceId }, "Task created");
  return taskRowToProto(row!);
}

/** Get a task by ID with computed status. */
export async function getTask(req: grackle.TaskId): Promise<grackle.Task> {
  const row = requireTask(req.id);
  const taskSessions = sessionStore.listSessionsForTask(req.id);
  const { status, latestSessionId } = computeTaskStatus(row.status, taskSessions);
  return taskRowToProto(row, undefined, status, latestSessionId);
}

/** Update task fields or late-bind a session to a task. */
export async function updateTask(req: grackle.UpdateTaskRequest): Promise<grackle.Task> {
  const existing = requireTask(req.id);

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

  if (req.dependsOn.length > 0) {
    if (req.dependsOn.includes(req.id)) {
      throw new ConnectError(`Task ${req.id} cannot depend on itself`, Code.InvalidArgument);
    }
    for (const depId of req.dependsOn) {
      requireTask(depId);
    }
    const cycle = taskStore.detectDependencyCycle(req.id, [...req.dependsOn]);
    if (cycle) {
      throw new ConnectError(
        `Circular dependency detected: ${req.id} → ${cycle.join(" → ")} → ${req.id}`,
        Code.InvalidArgument,
      );
    }
  }

  taskStore.updateTask(
    req.id,
    req.title !== "" ? req.title : existing.title,
    req.description !== "" ? req.description : existing.description,
    reqStatus,
    req.dependsOn.length > 0 ? [...req.dependsOn] : safeParseJsonArray(existing.dependsOn),
    req.defaultPersonaId,
  );

  // Update budget fields if explicitly set in the request (proto3 optional presence)
  requireNonNegativeBudget(req.tokenBudget, req.costBudgetMillicents);
  if (req.tokenBudget !== undefined || req.costBudgetMillicents !== undefined) {
    taskStore.updateTaskBudget(
      req.id,
      req.tokenBudget ?? existing.tokenBudget,
      req.costBudgetMillicents ?? existing.costBudgetMillicents,
    );
  }

  // Update the knowledge-injection flag when explicitly provided (#1259).
  if (req.injectKnowledge !== undefined) {
    taskStore.updateTaskInjectKnowledge(req.id, req.injectKnowledge);
  }

  // Late-bind: associate an existing session with this task
  if (req.sessionId !== "") {
    const session = requireSession(req.sessionId);
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
    emit("task.started", {
      taskId: req.id,
      sessionId: req.sessionId,
      workspaceId: existing.workspaceId || "",
    });
  }

  emit("task.updated", { taskId: req.id, workspaceId: existing.workspaceId || "" });
  logger.info({ taskId: req.id }, "Task updated");

  const row = taskStore.getTask(req.id);
  const taskSessions = sessionStore.listSessionsForTask(req.id);
  const { status, latestSessionId } = computeTaskStatus(row!.status, taskSessions);
  return taskRowToProto(row!, undefined, status, latestSessionId);
}

export { startTask } from "./task-start.js";
export {
  completeTask,
  setWorkpad,
  resumeTask,
  stopTask,
  deleteTask,
} from "./task-lifecycle-handlers.js";
