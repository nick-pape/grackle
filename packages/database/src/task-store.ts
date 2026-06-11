import db from "./db.js";
import { tasks, schedules, type TaskRow } from "./schema.js";
import { eq, and, or, sql, asc, inArray, type SQL } from "drizzle-orm";
import { taskStatusToEnum, taskStatusToString } from "@grackle-ai/common";
import type { TaskStatus } from "@grackle-ai/common";

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
  injectKnowledge: boolean;
  defaultPersonaId: string;
  tokenBudget: number;
  costBudgetMillicents: number;
  /**
   * Owning Agent id (#1418). NULL/undefined = user-driven task (today's path).
   * Set = the task is part of an Agent's tree.
   */
  agentId?: string;
  /**
   * Discriminator for agent-spawned tasks (#1418). Defaults to `task`.
   * Reserved values: `root | schedule_rule | schedule_fire | channel_config | channel_thread`.
   */
  kind?: string;
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
  const maxRowQuery = db.select({ maxOrder: sql<number>`max(sort_order)` }).from(tasks);
  const maxRow =
    sortOrderConditions.length > 0
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
      injectKnowledge: fields.injectKnowledge,
      defaultPersonaId: fields.defaultPersonaId,
      tokenBudget: fields.tokenBudget,
      costBudgetMillicents: fields.costBudgetMillicents,
      agentId: fields.agentId ?? null,
      kind: fields.kind ?? "task",
    })
    .run();
}

/** Retrieve a single task by ID. */
export function getTask(id: string): TaskRow | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

/** Options for filtering the task list. */
export interface ListTasksOptions {
  /** Case-insensitive substring filter on title or description. Case folding is ASCII-only (SQLite LIKE default). */
  search?: string;
  /** Exact match filter on task status (e.g. "not_started", "in_progress"). */
  status?: string;
}

/** Contract for task persistence. */
export interface TaskStore {
  insertTask(fields: InsertTaskFields): void;
  getTask(id: string): TaskRow | undefined;
  listTasks(workspaceId?: string, options?: ListTasksOptions): TaskRow[];
  updateTask(
    id: string,
    title: string,
    description: string,
    status: string,
    dependsOn: string[],
    defaultPersonaId?: string,
  ): void;
  updateTaskBudget(id: string, tokenBudget: number, costBudgetMillicents: number): void;
  updateTaskInjectKnowledge(id: string, injectKnowledge: boolean): void;
  setTaskWorkspace(id: string, workspaceId: string): void;
  setWorkpad(id: string, workpad: string): void;
  setTaskScheduleId(id: string, scheduleId: string): void;
  setTaskDependsOn(id: string, dependsOn: string[]): void;
  updateTaskStatus(id: string, status: TaskStatus): void;
  markTaskComplete(id: string, status?: "complete" | "failed"): void;
  deleteTask(id: string): number;
  getChildren(taskId: string): TaskRow[];
  setTaskParentAndDepth(taskId: string, parentTaskId: string, depth: number): void;
  bumpTaskDepths(taskIds: string[], delta: number): void;
  getRootTaskForAgent(agentId: string): TaskRow | undefined;
  getTasksForAgent(agentId: string): TaskRow[];
}

/** Escape LIKE special characters so they match literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

/** Return tasks for a workspace (or all tasks when workspaceId is omitted), with optional search/status filters, ordered by sort_order then created_at. */
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

  const query = db.select().from(tasks);
  const filtered = conditions.length > 0 ? query.where(and(...conditions)) : query;
  return filtered.orderBy(asc(tasks.sortOrder), asc(tasks.createdAt)).all();
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
  db.update(tasks).set(sets).where(eq(tasks.id, id)).run();
}

/** Update the token and cost budget for a task. */
export function updateTaskBudget(
  id: string,
  tokenBudget: number,
  costBudgetMillicents: number,
): void {
  db.update(tasks)
    .set({
      tokenBudget,
      costBudgetMillicents,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(tasks.id, id))
    .run();
}

/** Update a task's knowledge-injection flag (#1259). */
export function updateTaskInjectKnowledge(id: string, injectKnowledge: boolean): void {
  db.update(tasks)
    .set({
      injectKnowledge,
      updatedAt: sql`datetime('now')`,
    })
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
export function markTaskComplete(id: string, status: "complete" | "failed" = "complete"): void {
  db.update(tasks)
    .set({
      status,
      completedAt: sql`datetime('now')`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(tasks.id, id))
    .run();
}

/**
 * Delete a task by ID. Returns the number of rows affected (0 or 1).
 *
 * Cascades through `schedules.task_id` (#1438): any heartbeat schedule
 * targeting this task is deleted first to satisfy the nullable FK. Per
 * project convention FKs are declared without `ON DELETE CASCADE` and the
 * app layer is responsible for cleanup; this mirrors what `deleteAgent`
 * does for `tasks.agent_id` (see migration v22 comments).
 */
export function deleteTask(id: string): number {
  db.delete(schedules).where(eq(schedules.taskId, id)).run();
  const result = db.delete(tasks).where(eq(tasks.id, id)).run();
  return result.changes;
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

/**
 * Set the parent task ID and depth for a single task.
 * Used by the task service when reparenting a subtree.
 */
export function setTaskParentAndDepth(taskId: string, parentTaskId: string, depth: number): void {
  db.update(tasks)
    .set({
      parentTaskId,
      depth,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(tasks.id, taskId))
    .run();
}

/**
 * Adjust `depth` for a batch of tasks by a signed integer delta.
 * Used by the task service to cascade depth updates across a reparented subtree.
 */
export function bumpTaskDepths(taskIds: string[], delta: number): void {
  if (taskIds.length === 0) {
    return;
  }
  db.update(tasks)
    .set({
      depth: sql`${tasks.depth} + ${delta}`,
      updatedAt: sql`datetime('now')`,
    })
    .where(inArray(tasks.id, taskIds))
    .run();
}

/**
 * Return the root task for a given Agent — the singleton task with
 * `agent_id = agentId AND kind = 'root'`. Returns `undefined` when the
 * Agent has no root yet (the auto-create subscriber runs on `agent.created`).
 */
export function getRootTaskForAgent(agentId: string): TaskRow | undefined {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.agentId, agentId), eq(tasks.kind, "root")))
    .get();
}

/** Return all tasks owned by an Agent (root + descendants). Used for cascade-delete. */
export function getTasksForAgent(agentId: string): TaskRow[] {
  return db.select().from(tasks).where(eq(tasks.agentId, agentId)).all();
}

const _typeCheck: TaskStore = {
  insertTask,
  getTask,
  listTasks,
  updateTask,
  updateTaskBudget,
  updateTaskInjectKnowledge,
  setTaskWorkspace,
  setWorkpad,
  setTaskScheduleId,
  setTaskDependsOn,
  updateTaskStatus,
  markTaskComplete,
  deleteTask,
  getChildren,
  setTaskParentAndDepth,
  bumpTaskDepths,
  getRootTaskForAgent,
  getTasksForAgent,
};
void _typeCheck;
