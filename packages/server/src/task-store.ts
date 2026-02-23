import db from "./db.js";
import { tasks, type TaskRow } from "./schema.js";
import { eq, sql, asc } from "drizzle-orm";
import type { TaskStatus } from "@grackle/common";

export type { TaskRow };

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

/** Insert a new task with auto-generated branch name and sort order. */
export function createTask(
  id: string,
  projectId: string,
  title: string,
  description: string,
  environmentId: string,
  dependsOn: string[],
  projectSlug: string,
): void {
  const branch = `${projectSlug}/${slugify(title)}`;
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
    const deps = JSON.parse(task.dependsOn) as string[];
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
  const deps = JSON.parse(task.dependsOn) as string[];
  if (deps.length === 0) {
    return true;
  }
  return deps.every((depId) => {
    const dep = getTask(depId);
    return dep?.status === "done";
  });
}
