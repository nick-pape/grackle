import db from "./db.js";
import { tasks, type TaskRow } from "./schema.js";
import { eq, and, or, sql, asc } from "drizzle-orm";
import { TASK_STATUS, taskStatusToEnum, taskStatusToString } from "@grackle-ai/common";
import type { TaskStatus } from "@grackle-ai/common";
import { MAX_TASK_DEPTH } from "@grackle-ai/common";
import { safeParseJsonArray } from "./json-helpers.js";
import { slugify } from "./utils/slugify.js";

export type { TaskRow };

/** Insert a new task with auto-generated branch name and sort order. */
export function createTask(
  id: string,
  projectId: string,
  title: string,
  description: string,
  dependsOn: string[],
  projectSlug: string,
  parentTaskId: string = "",
  canDecompose?: boolean,
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
    branch = `${projectSlug}/${slugify(title)}`;
  }

  // Derive canDecompose when not explicitly set: root=true, child=false
  const resolvedCanDecompose = canDecompose ?? !parentTaskId;

  const depsJson = JSON.stringify(dependsOn);
  const maxRow = db
    .select({ maxOrder: sql<number>`max(sort_order)` })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .get();
  const sortOrder = (maxRow?.maxOrder ?? -1) + 1;
  db.insert(tasks)
    .values({
      id,
      projectId,
      title,
      description,
      branch,
      dependsOn: depsJson,
      sortOrder,
      parentTaskId,
      depth,
      canDecompose: resolvedCanDecompose,
    })
    .run();
}

/** Retrieve a single task by ID. */
export function getTask(id: string): TaskRow | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

/** Options for filtering the task list. */
export interface ListTasksOptions {
  /** Case-insensitive substring filter on title or description. */
  search?: string;
  /** Exact match filter on task status (e.g. "not_started", "in_progress"). */
  status?: string;
}

/** Escape LIKE special characters so they match literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

/** Return tasks for a project, with optional search/status filters, ordered by sort_order then created_at. */
export function listTasks(projectId: string, options?: ListTasksOptions): TaskRow[] {
  const conditions = [eq(tasks.projectId, projectId)];

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

  if (options?.search) {
    const escaped = escapeLikePattern(options.search);
    const pattern = `%${escaped}%`;
    conditions.push(
      or(
        sql`${tasks.title} LIKE ${pattern} ESCAPE '\\'`,
        sql`${tasks.description} LIKE ${pattern} ESCAPE '\\'`,
      )!,
    );
  }

  return db
    .select()
    .from(tasks)
    .where(and(...conditions))
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
): void {
  db.update(tasks)
    .set({
      title,
      description,
      status,
      dependsOn: JSON.stringify(dependsOn),
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
export function getUnblockedTasks(projectId: string): TaskRow[] {
  const all = listTasks(projectId);
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
export function checkAndUnblock(projectId: string): TaskRow[] {
  return getUnblockedTasks(projectId);
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

/** Get all descendants of a task (full subtree) via in-memory BFS. Fetches all project tasks once to avoid N+1 queries. */
export function getDescendants(taskId: string): TaskRow[] {
  const task = getTask(taskId);
  if (!task) {
    return [];
  }
  const allRows = listTasks(task.projectId);
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
