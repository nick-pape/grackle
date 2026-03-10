import db from "./db.js";
import { tasks, type TaskRow } from "./schema.js";
import { eq, sql, asc } from "drizzle-orm";
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
  environmentId: string,
  dependsOn: string[],
  projectSlug: string,
  parentTaskId: string = "",
): void {
  let depth = 0;
  let branch: string;

  if (parentTaskId) {
    const parent = getTask(parentTaskId);
    if (!parent) {
      throw new Error(`Parent task not found: ${parentTaskId}`);
    }
    depth = parent.depth + 1;
    if (depth > MAX_TASK_DEPTH) {
      throw new Error(`Task depth would exceed maximum of ${MAX_TASK_DEPTH}`);
    }
    branch = `${parent.branch}/${slugify(title)}`;
  } else {
    branch = `${projectSlug}/${slugify(title)}`;
  }

  const depsJson = JSON.stringify(dependsOn);
  const maxRow = db.select({ maxOrder: sql<number>`max(sort_order)` })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .get();
  const sortOrder = (maxRow?.maxOrder ?? -1) + 1;
  db.insert(tasks).values({
    id,
    projectId,
    title,
    description,
    branch,
    environmentId,
    dependsOn: depsJson,
    sortOrder,
    parentTaskId,
    depth,
  }).run();
}

/** Retrieve a single task by ID. */
export function getTask(id: string): TaskRow | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

/** Return all tasks for a project, ordered by sort_order then created_at. */
export function listTasks(projectId: string): TaskRow[] {
  return db.select().from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    .all();
}

/** Update multiple task fields at once. */
export function updateTask(
  id: string,
  title: string,
  description: string,
  status: string,
  environmentId: string,
  dependsOn: string[],
  reviewNotes: string,
): void {
  db.update(tasks).set({
    title,
    description,
    status,
    environmentId,
    dependsOn: JSON.stringify(dependsOn),
    reviewNotes,
    updatedAt: sql`datetime('now')`,
  }).where(eq(tasks.id, id)).run();
}

/** Update only the task status. */
export function updateTaskStatus(id: string, status: TaskStatus): void {
  db.update(tasks).set({
    status,
    updatedAt: sql`datetime('now')`,
  }).where(eq(tasks.id, id)).run();
}

/** Set the session ID for a task. */
export function setTaskSession(id: string, sessionId: string): void {
  db.update(tasks).set({
    sessionId,
    updatedAt: sql`datetime('now')`,
  }).where(eq(tasks.id, id)).run();
}

/** Mark a task as in_progress with a started_at timestamp. */
export function markTaskStarted(id: string): void {
  db.update(tasks).set({
    status: "in_progress",
    startedAt: sql`datetime('now')`,
    updatedAt: sql`datetime('now')`,
  }).where(eq(tasks.id, id)).run();
}

/** Mark a task as completed (review, done, or failed) with a completed_at timestamp. */
export function markTaskCompleted(id: string, status: "review" | "done" | "failed"): void {
  db.update(tasks).set({
    status,
    completedAt: sql`datetime('now')`,
    updatedAt: sql`datetime('now')`,
  }).where(eq(tasks.id, id)).run();
}

/** Delete a task by ID. */
export function deleteTask(id: string): void {
  db.delete(tasks).where(eq(tasks.id, id)).run();
}

/** Return all pending tasks whose dependencies are fully met. */
export function getUnblockedTasks(projectId: string): TaskRow[] {
  const all = listTasks(projectId);
  return all.filter((task) => {
    if (task.status !== "pending") {
      return false;
    }
    const deps = safeParseJsonArray(task.dependsOn);
    if (deps.length === 0) {
      return true;
    }
    return deps.every((depId) => {
      const dep = all.find((t) => t.id === depId);
      return dep?.status === "done";
    });
  });
}

/** Alias for getUnblockedTasks — check which pending tasks are now unblocked. */
export function checkAndUnblock(projectId: string): TaskRow[] {
  return getUnblockedTasks(projectId);
}

/** Check whether all dependencies of a task are in "done" status. */
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
    return dep?.status === "done";
  });
}

// ─── Tree Queries ────────────────────────────────────

/** Get direct children of a task, ordered by sort_order. */
export function getChildren(taskId: string): TaskRow[] {
  return db.select().from(tasks)
    .where(eq(tasks.parentTaskId, taskId))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    .all();
}

/** Get all descendants of a task (full subtree) via iterative BFS. */
export function getDescendants(taskId: string): TaskRow[] {
  const result: TaskRow[] = [];
  const queue: string[] = [taskId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = getChildren(currentId);
    for (const child of children) {
      result.push(child);
      queue.push(child.id);
    }
  }
  return result;
}

/** Get ancestor chain from task up to root, ordered root-first. */
export function getAncestors(taskId: string): TaskRow[] {
  const ancestors: TaskRow[] = [];
  let current = getTask(taskId);
  while (current && current.parentTaskId) {
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
