/**
 * Task service — single home for all task business logic.
 *
 * Responsibilities:
 *  - Validate and create tasks (parent check, depth limit, branch generation, canDecompose)
 *  - Dependency resolution (areDependenciesMet, getUnblockedTasks, detectDependencyCycle)
 *  - Tree derivation (getDescendants, getAncestors, getChildStatusCounts, reparentTask, …)
 *
 * All validation errors are thrown as typed {@link GrackleError} subclasses so the
 * server-side interceptor maps them to the correct gRPC status code automatically.
 *
 * @see packages/database/src/CLAUDE.md — "Stores are pure data access."
 */

import { v4 as uuid } from "uuid";
import { TASK_STATUS, MAX_TASK_DEPTH, NotFoundError, PreconditionError } from "@grackle-ai/common";
import { getDatabaseStores, safeParseJsonArray, slugify, type TaskRow } from "@grackle-ai/database";

// ─── Public Parameter Types ────────────────────────────────────────────────

/**
 * Parameters for creating a new task.
 * Object form of the previous 14-positional-arg `taskStore.createTask` signature.
 */
export interface CreateTaskParams {
  /** Workspace to scope the task to. */
  workspaceId?: string;
  /** Short human-readable title (required). */
  title: string;
  /** Longer description (defaults to empty string). */
  description?: string;
  /** IDs of tasks that must be complete before this one can start. */
  dependsOn?: string[];
  /** Parent task ID for subtask creation. Empty string or omitted = root task. */
  parentTaskId?: string;
  /** Whether this task may be decomposed into subtasks. Derived when omitted. */
  canDecompose?: boolean;
  /** Default persona ID to use when spawning sessions. */
  defaultPersonaId?: string;
  /** Token budget cap (0 = unlimited). */
  tokenBudget?: number;
  /** Cost budget in millicents (0 = unlimited). */
  costBudgetMillicents?: number;
  /** Inject knowledge context at spawn time (#1259). Defaults to true. */
  injectKnowledge?: boolean;
  /** Owning agent ID (#1418). NULL = user-driven task. */
  agentId?: string;
  /**
   * Discriminator for agent-spawned tasks (#1418).
   * Reserved values: `root | schedule_rule | schedule_fire | channel_config | channel_thread`.
   */
  kind?: string;
  /** Pre-assigned task ID. Auto-generated (uuid slice 0-8) when omitted. */
  id?: string;
}

// ─── Terminal Status Set (moved from task-store) ───────────────────────────

/** Terminal task statuses that indicate the task is done. */
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  TASK_STATUS.COMPLETE,
  TASK_STATUS.FAILED,
]);

// ─── TaskService Interface ─────────────────────────────────────────────────

/** Full contract for task business logic. */
export interface TaskService {
  createTask(params: CreateTaskParams): TaskRow;
  getUnblockedTasks(workspaceId?: string): TaskRow[];
  checkAndUnblock(workspaceId?: string): TaskRow[];
  areDependenciesMet(taskId: string): boolean;
  detectDependencyCycle(taskId: string, proposedDependsOn: string[]): string[] | undefined;
  buildChildIdsMap(rows: TaskRow[]): Map<string, string[]>;
  getDescendants(taskId: string): TaskRow[];
  getAncestors(taskId: string): TaskRow[];
  getChildStatusCounts(taskId: string): Record<string, number>;
  reparentTask(taskId: string, newParentTaskId: string): void;
  getOrphanedTasks(parentTaskId: string): TaskRow[];
}

// ─── Task Creation ─────────────────────────────────────────────────────────

/**
 * Create a new task with full validation.
 *
 * Validates parent existence and decomposition rights, enforces the depth
 * limit, derives `canDecompose` and `branch`, then delegates to
 * `taskStore.insertTask`.
 *
 * @throws {@link NotFoundError} when the parent task or a dependency task does not exist.
 * @throws {@link PreconditionError} when the parent task lacks decomposition rights or the
 *   depth limit would be exceeded.
 */
export function createTask(params: CreateTaskParams): TaskRow {
  const { taskStore, workspaceStore } = getDatabaseStores();

  const {
    workspaceId,
    title,
    description = "",
    dependsOn = [],
    parentTaskId = "",
    canDecompose,
    defaultPersonaId = "",
    tokenBudget = 0,
    costBudgetMillicents = 0,
    injectKnowledge = true,
    agentId,
    kind,
    id: providedId,
  } = params;

  let depth = 0;
  let branch: string;

  if (parentTaskId) {
    const parent = taskStore.getTask(parentTaskId);
    if (!parent) {
      throw new NotFoundError(`Parent task not found: ${parentTaskId}`, {
        parentTaskId,
      });
    }
    if (!parent.canDecompose) {
      throw new PreconditionError(
        `Parent task "${parent.title}" (${parentTaskId}) does not have decomposition rights`,
        { parentTaskId, parentTitle: parent.title },
      );
    }
    depth = parent.depth + 1;
    if (depth > MAX_TASK_DEPTH) {
      throw new PreconditionError(`Task depth would exceed maximum of ${MAX_TASK_DEPTH}`, {
        depth,
        maxDepth: MAX_TASK_DEPTH,
      });
    }
    branch = `${parent.branch}/${slugify(title)}`;
  } else {
    // Resolve workspace slug for root-level branch name
    let workspaceSlug = "";
    if (workspaceId) {
      const workspace = workspaceStore.getWorkspace(workspaceId);
      if (!workspace) {
        throw new NotFoundError(`Workspace not found: ${workspaceId}`, { workspaceId });
      }
      workspaceSlug = slugify(workspace.name);
    }
    const prefix = workspaceSlug || "task";
    branch = `${prefix}/${slugify(title)}`;
  }

  // Validate each dependency exists
  for (const depId of dependsOn) {
    if (!taskStore.getTask(depId)) {
      throw new NotFoundError(`Task not found: ${depId}`, { depId });
    }
  }

  // Derive canDecompose when not explicitly set: root = true, child = false
  const resolvedCanDecompose = canDecompose ?? !parentTaskId;

  const id = providedId ?? uuid().slice(0, 8);

  taskStore.insertTask({
    id,
    workspaceId,
    title,
    description,
    branch,
    dependsOn,
    parentTaskId,
    depth,
    canDecompose: resolvedCanDecompose,
    injectKnowledge,
    defaultPersonaId,
    tokenBudget,
    costBudgetMillicents,
    agentId,
    kind,
  });

  const row = taskStore.getTask(id);
  if (!row) {
    throw new Error(`createTask: row not found immediately after insert (id=${id})`);
  }
  return row;
}

// ─── Dependency Resolution ─────────────────────────────────────────────────

/**
 * Return all not_started tasks whose dependencies are fully met.
 * Scoped to the given workspace when provided.
 */
export function getUnblockedTasks(workspaceId?: string): TaskRow[] {
  const { taskStore } = getDatabaseStores();
  const all = taskStore.listTasks(workspaceId);
  const byId = new Map<string, TaskRow>(all.map((t) => [t.id, t]));
  return all.filter((task) => {
    if (task.status !== TASK_STATUS.NOT_STARTED) {
      return false;
    }
    const deps = safeParseJsonArray(task.dependsOn);
    if (deps.length === 0) {
      return true;
    }
    return deps.every((depId) => byId.get(depId)?.status === TASK_STATUS.COMPLETE);
  });
}

/**
 * Alias for {@link getUnblockedTasks} — check which pending tasks are now unblocked.
 */
export function checkAndUnblock(workspaceId?: string): TaskRow[] {
  return getUnblockedTasks(workspaceId);
}

/**
 * Check whether all dependencies of a task are in "complete" status.
 */
export function areDependenciesMet(taskId: string): boolean {
  const { taskStore } = getDatabaseStores();
  const task = taskStore.getTask(taskId);
  if (!task) {
    return false;
  }
  const uniqueDeps = [...new Set(safeParseJsonArray(task.dependsOn))];
  if (uniqueDeps.length === 0) {
    return true;
  }
  for (const depId of uniqueDeps) {
    const dep = taskStore.getTask(depId);
    if (dep?.status !== TASK_STATUS.COMPLETE) {
      return false;
    }
  }
  return true;
}

/**
 * Detect whether adding the proposed dependencies to a task would create a cycle.
 *
 * Returns the cycle path (array of task IDs) if a cycle exists, or undefined if safe.
 */
export function detectDependencyCycle(
  taskId: string,
  proposedDependsOn: string[],
): string[] | undefined {
  const { taskStore } = getDatabaseStores();

  if (proposedDependsOn.includes(taskId)) {
    return [taskId];
  }
  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue = [...proposedDependsOn];
  for (const depId of proposedDependsOn) {
    parent.set(depId, taskId);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) {
      const path: string[] = [];
      let node = parent.get(current)!;
      while (node !== taskId) {
        path.unshift(node);
        node = parent.get(node)!;
      }
      return path;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const task = taskStore.getTask(current);
    if (!task) {
      continue;
    }
    for (const depId of safeParseJsonArray(task.dependsOn)) {
      if (!visited.has(depId)) {
        parent.set(depId, current);
        queue.push(depId);
      }
    }
  }
  return undefined;
}

// ─── Tree Derivation ───────────────────────────────────────────────────────

/**
 * Build a map from parentTaskId to child IDs from a pre-fetched list of rows.
 * Avoids N+1 queries.
 */
export function buildChildIdsMap(rows: TaskRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (row.parentTaskId) {
      const siblings = map.get(row.parentTaskId);
      if (siblings) {
        siblings.push(row.id);
      } else {
        map.set(row.parentTaskId, [row.id]);
      }
    }
  }
  return map;
}

/**
 * Get all descendants of a task (full subtree) via in-memory BFS.
 * Fetches all workspace tasks once to avoid N+1 queries.
 */
export function getDescendants(taskId: string): TaskRow[] {
  const { taskStore } = getDatabaseStores();
  const task = taskStore.getTask(taskId);
  if (!task) {
    return [];
  }
  const allRows = taskStore.listTasks(task.workspaceId || undefined);
  const childIdsMap = buildChildIdsMap(allRows);
  const rowById = new Map<string, TaskRow>(allRows.map((r) => [r.id, r]));

  const result: TaskRow[] = [];
  const queue: string[] = [taskId];
  for (let i = 0; i < queue.length; i++) {
    const currentId = queue[i]!;
    const childIds = childIdsMap.get(currentId);
    if (!childIds) {
      continue;
    }
    for (const childId of childIds) {
      const child = rowById.get(childId);
      if (child) {
        result.push(child);
        queue.push(child.id);
      }
    }
  }
  return result;
}

/**
 * Get ancestor chain from task up to root, ordered root-first.
 */
export function getAncestors(taskId: string): TaskRow[] {
  const { taskStore } = getDatabaseStores();
  const task = taskStore.getTask(taskId);
  if (!task?.parentTaskId) {
    return [];
  }

  const allRows = taskStore.listTasks(task.workspaceId || undefined);
  const byId = new Map<string, TaskRow>(allRows.map((r) => [r.id, r]));

  const ancestors: TaskRow[] = [];
  let current: TaskRow = task;
  while (current.parentTaskId) {
    const ancestorParent = byId.get(current.parentTaskId);
    if (!ancestorParent) {
      break;
    }
    ancestors.unshift(ancestorParent);
    current = ancestorParent;
  }
  return ancestors;
}

/**
 * Count children by status for a parent task.
 */
export function getChildStatusCounts(taskId: string): Record<string, number> {
  const { taskStore } = getDatabaseStores();
  const children = taskStore.getChildren(taskId);
  const counts: Record<string, number> = {};
  for (const child of children) {
    counts[child.status] = (counts[child.status] ?? 0) + 1;
  }
  return counts;
}

/**
 * Get non-terminal children of a parent task (potential orphans).
 * Returns children whose status is not complete or failed.
 */
export function getOrphanedTasks(parentTaskId: string): TaskRow[] {
  const { taskStore } = getDatabaseStores();
  return taskStore
    .getChildren(parentTaskId)
    .filter((child) => !TERMINAL_TASK_STATUSES.has(child.status));
}

/**
 * Reparent a task to a new parent, updating parentTaskId and recalculating
 * depth for the task and its entire subtree.
 *
 * @throws {@link NotFoundError} when the task or new parent task does not exist.
 */
export function reparentTask(taskId: string, newParentTaskId: string): void {
  const { taskStore } = getDatabaseStores();

  const task = taskStore.getTask(taskId);
  if (!task) {
    throw new NotFoundError(`Task not found: ${taskId}`, { taskId });
  }
  const newParent = taskStore.getTask(newParentTaskId);
  if (!newParent) {
    throw new NotFoundError(`New parent task not found: ${newParentTaskId}`, {
      newParentTaskId,
    });
  }

  const newDepth = newParent.depth + 1;
  const depthDelta = newDepth - task.depth;

  taskStore.setTaskParentAndDepth(taskId, newParentTaskId, newDepth);

  if (depthDelta !== 0) {
    const descendants = getDescendants(taskId);
    if (descendants.length > 0) {
      const descendantIds = descendants.map((d) => d.id);
      taskStore.bumpTaskDepths(descendantIds, depthDelta);
    }
  }
}

// ─── Compile-time interface conformance check ──────────────────────────────

const _typeCheck: TaskService = {
  createTask,
  getUnblockedTasks,
  checkAndUnblock,
  areDependenciesMet,
  detectDependencyCycle,
  buildChildIdsMap,
  getDescendants,
  getAncestors,
  getChildStatusCounts,
  reparentTask,
  getOrphanedTasks,
};
_typeCheck satisfies TaskService;
