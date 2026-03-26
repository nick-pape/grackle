import db from "./db.js";
import { tasks, type TaskRow } from "./schema.js";
import { eq, and, sql, asc, type SQL } from "drizzle-orm";
import { TASK_STATUS, taskStatusToEnum, taskStatusToString } from "@grackle-ai/common";
import type { TaskStatus } from "@grackle-ai/common";
import { MAX_TASK_DEPTH } from "@grackle-ai/common";
import { safeParseJsonArray } from "./json-helpers.js";
import { slugify } from "./utils/slugify.js";

export type { TaskRow };

/** Fields required to insert a task row directly (no business logic). */
export interface InsertTaskFields {
  id: string;
  workspaceId?: string;
  title: string;
  description: string;
  branch: string;
  dependsOn: string[];
  parentTaskId: string;
  depth: number;
  canDecompose: boolean;
  defaultPersonaId: string;
}

/**
 * Low-level insert — writes a task row with all fields pre-computed.
 * Auto-assigns `sortOrder` based on the workspace's current max.
 * No business logic (parent validation, branch generation, depth limits).
 */
export function insertTask(fields: InsertTaskFields): void {
  const depsJson = JSON.stringify(fields.dependsOn);
  const sortOrderConditions: SQL[] = [];
  if (fields.workspaceId) {
    sortOrderConditions.push(eq(tasks.workspaceId, fields.workspaceId));
  }
  const maxRowQuery = db
    .select({ maxOrder: sql<number>`max(sort_order)` })
    .from(tasks);
  const maxRow = sortOrderConditions.length > 0
    ? maxRowQuery.where(and(...sortOrderConditions)).get()
    : maxRowQuery.get();
  const sortOrder = (maxRow?.maxOrder ?? -1) + 1;
  db.insert(tasks)
    .values({
      id: fields.id,
      workspaceId: fields.workspaceId || null,
      title: fields.title,
      description: fields.description,
      branch: fields.branch,
      dependsOn: depsJson,
      sortOrder,
      parentTaskId: fields.parentTaskId,
      depth: fields.depth,
      canDecompose: fields.canDecompose,
      defaultPersonaId: fields.defaultPersonaId,
    })
    .run();
}

/**
 * Create a task with business logic: validates parent, enforces depth limits,
 * auto-generates branch name, and derives canDecompose.
 * Delegates the actual insert to {@link insertTask}.
 */
export function createTask(
  id: string,
  workspaceId: string | undefined,
  title: string,
  description: string,
  dependsOn: string[],
  workspaceSlug: string,
  parentTaskId: string = "",
  canDecompose?: boolean,
  defaultPersonaId: string = "",
): void {
  let depth = 0;
  let branch: string;

  if (parentTaskId) {
    const parent = getTask(parentTaskId);
    if (!parent) {
      throw new Error(`Parent task not found: ${parentTaskId}`);
    }
    if (!parent.canDecompose) {
      throw new Error(
        `Parent task "${parent.title}" (${parentTaskId}) does not have decomposition rights`,
      );
    }
    depth = parent.depth + 1;
    if (depth > MAX_TASK_DEPTH) {
      throw new Error(`Task depth would exceed maximum of ${MAX_TASK_DEPTH}`);
    }
    branch = `${parent.branch}/${slugify(title)}`;
  } else {
    const prefix = workspaceSlug || "task";
    branch = `${prefix}/${slugify(title)}`;
  }

  // Derive canDecompose when not explicitly set: root=true, child=false
  const resolvedCanDecompose = canDecompose ?? !parentTaskId;

  insertTask({
    id,
    workspaceId,
    title,
    description,
    branch,
    dependsOn,
    parentTaskId,
    depth,
    canDecompose: resolvedCanDecompose,
    defaultPersonaId,
  });
}

/** Retrieve a single task by ID. */
export function getTask(id: string): TaskRow | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

/** Options for filtering the task list. */
export interface ListTasksOptions {
  /** Exact match filter on task status (e.g. "not_started", "in_progress"). */
  status?: string;
}

/** Return tasks for a workspace (or all tasks when workspaceId is omitted), with optional status filter, ordered by sort_order then created_at. */
export function listTasks(workspaceId?: string, options?: ListTasksOptions): TaskRow[] {
  const conditions: SQL[] = [];
  if (workspaceId) {
    conditions.push(eq(tasks.workspaceId, workspaceId));
  }

  if (options?.status) {
    // Normalize legacy status aliases (e.g. "in_progress" → "working")
    const canonical = taskStatusToString(taskStatusToEnum(options.status));
    if (canonical) {
      conditions.push(eq(tasks.status, canonical));
    } else {
      // Unknown status — match nothing rather than ignoring the filter
      conditions.push(sql`0`);
    }
  }

  const query = db
    .select()
    .from(tasks);
  const filtered = conditions.length > 0
    ? query.where(and(...conditions))
    : query;
  return filtered
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    .all();
}

/** Update multiple task fields at once. */
export function updateTask(
  id: string,
  title: string,
  description: string,
  status: string,
  dependsOn: string[],
  defaultPersonaId?: string,
): void {
  const sets: Record<string, unknown> = {
    title,
    description,
    status,
    dependsOn: JSON.stringify(dependsOn),
    updatedAt: sql`datetime('now')`,
  };
  if (defaultPersonaId !== undefined) {
    sets.defaultPersonaId = defaultPersonaId;
  }
  db.update(tasks)
    .set(sets)
    .where(eq(tasks.id, id))
    .run();
}

/** Assign a workspace to a task. */
export function setTaskWorkspace(id: string, workspaceId: string): void {
  db.update(tasks)
    .set({
      workspaceId,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(tasks.id, id))
    .run();
}

/** Update the workpad (persistent structured context) of a task. */
export function setWorkpad(id: string, workpad: string): void {
  db.update(tasks)
    .set({
      workpad,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(tasks.id, id))
    .run();
}

/** Set the schedule ID that created this task. */
export function setTaskScheduleId(id: string, scheduleId: string): void {
  db.update(tasks)
    .set({
      scheduleId,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(tasks.id, id))
    .run();
}

/** Update only the dependsOn array of a task. */
export function setTaskDependsOn(id: string, dependsOn: string[]): void {
  db.update(tasks)
    .set({
      dependsOn: JSON.stringify(dependsOn),
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(tasks.id, id))
    .run();
}

/** Update only the task status. */
export function updateTaskStatus(id: string, status: TaskStatus): void {
  db.update(tasks)
    .set({
      status,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(tasks.id, id))
    .run();
}

/**
 * Mark a task as complete with a completed_at timestamp.
 * Used only for human-authoritative status transitions (complete).
 */
export function markTaskComplete(
  id: string,
  status: "complete" | "failed" = "complete",
): void {
  db.update(tasks)
    .set({
      status,
      completedAt: sql`datetime('now')`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(tasks.id, id))
    .run();
}

/** Delete a task by ID. Returns the number of rows affected. */
export function deleteTask(id: string): number {
  const result = db.delete(tasks).where(eq(tasks.id, id)).run();
  return result.changes;
}

/** Return all not_started tasks whose dependencies are fully met. */
export function getUnblockedTasks(workspaceId?: string): TaskRow[] {
  const all = listTasks(workspaceId);
  return all.filter((task) => {
    if (task.status !== TASK_STATUS.NOT_STARTED) {
      return false;
    }
    const deps = safeParseJsonArray(task.dependsOn);
    if (deps.length === 0) {
      return true;
    }
    return deps.every((depId) => {
      const dep = all.find((t) => t.id === depId);
      return dep?.status === TASK_STATUS.COMPLETE;
    });
  });
}

/** Alias for getUnblockedTasks — check which pending tasks are now unblocked. */
export function checkAndUnblock(workspaceId?: string): TaskRow[] {
  return getUnblockedTasks(workspaceId);
}

/** Check whether all dependencies of a task are in "complete" status. */
export function areDependenciesMet(taskId: string): boolean {
  const task = getTask(taskId);
  if (!task) {
    return false;
  }
  const deps = safeParseJsonArray(task.dependsOn);
  if (deps.length === 0) {
    return true;
  }
  return deps.every((depId) => {
    const dep = getTask(depId);
    return dep?.status === TASK_STATUS.COMPLETE;
  });
}

// ─── Tree Queries ────────────────────────────────────

/** Build a map from parentTaskId to child IDs from a pre-fetched list of rows. Avoids N+1 queries. */
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

/** Get direct children of a task, ordered by sort_order. */
export function getChildren(taskId: string): TaskRow[] {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.parentTaskId, taskId))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    .all();
}

/** Get all descendants of a task (full subtree) via in-memory BFS. Fetches all workspace tasks once to avoid N+1 queries. */
export function getDescendants(taskId: string): TaskRow[] {
  const task = getTask(taskId);
  if (!task) {
    return [];
  }
  const allRows = listTasks(task.workspaceId || undefined);
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

/** Get ancestor chain from task up to root, ordered root-first. */
export function getAncestors(taskId: string): TaskRow[] {
  const ancestors: TaskRow[] = [];
  let current = getTask(taskId);
  while (current?.parentTaskId) {
    const parent = getTask(current.parentTaskId);
    if (!parent) {
      break;
    }
    ancestors.unshift(parent);
    current = parent;
  }
  return ancestors;
}

/** Count children by status for a parent task. */
export function getChildStatusCounts(taskId: string): Record<string, number> {
  const children = getChildren(taskId);
  const counts: Record<string, number> = {};
  for (const child of children) {
    counts[child.status] = (counts[child.status] ?? 0) + 1;
  }
  return counts;
}
