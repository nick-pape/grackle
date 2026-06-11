import db from "./db.js";
import { schedules, type ScheduleRow } from "./schema.js";
import { eq, and, ne, lte, sql, isNotNull, isNull } from "drizzle-orm";
import { serverTimestamp } from "@grackle-ai/common";

export type { ScheduleRow };

/** Contract for schedule persistence. */
export interface ScheduleStore {
  createSchedule(
    id: string,
    title: string,
    description: string,
    scheduleExpression: string,
    personaId: string,
    workspaceId: string,
    parentTaskId: string,
    nextRunAt: string | null,
    taskId?: string | null,
    agentId?: string | null,
  ): void;
  getSchedule(id: string): ScheduleRow | undefined;
  listSchedules(workspaceId?: string): ScheduleRow[];
  updateSchedule(id: string, update: ScheduleUpdate): void;
  getHeartbeatForTask(taskId: string): ScheduleRow | undefined;
  deleteSchedule(id: string): void;
  getDueSchedules(): ScheduleRow[];
  advanceSchedule(id: string, lastRunAt: string, nextRunAt: string): void;
  setScheduleEnabled(id: string, enabled: boolean, nextRunAt: string | null): void;
  /** Detach all schedules owned by the given agent (set agent_id to null). */
  detachSchedulesForAgent(agentId: string): void;
}

/** Fields that can be updated on a schedule. */
export interface ScheduleUpdate {
  title?: string;
  description?: string;
  scheduleExpression?: string;
  personaId?: string;
  enabled?: boolean;
  nextRunAt?: string | null;
  taskId?: string | null;
  /** Set to a non-empty string to attach an Agent; null / "" to detach. #1439. */
  // eslint-disable-next-line @rushstack/no-new-null
  agentId?: string | null;
}

/**
 * Create a new schedule entry.
 *
 * @param id - Unique schedule ID
 * @param title - Human-readable title
 * @param description - Optional description
 * @param scheduleExpression - Interval shorthand or cron expression
 * @param personaId - Persona to use when firing (may be empty when agentId is set;
 *   the cron phase resolves the effective persona from the agent's primaryPersonaId)
 * @param workspaceId - Optional workspace scope (empty = system-level)
 * @param parentTaskId - Parent task for spawned children (empty = ROOT_TASK_ID)
 * @param nextRunAt - Pre-computed next fire time (null if disabled)
 * @param taskId - Heartbeat target task (non-null = reanimate that task's session
 *   each tick; null = today's fresh-task-spawn schedule). Defaults to null. #1438.
 * @param agentId - Owning Agent id (non-null = fires under Agent identity,
 *   fire-tasks carry agent_id + kind=schedule_fire, parent = Agent root). #1439.
 */
export function createSchedule(
  id: string,
  title: string,
  description: string,
  scheduleExpression: string,
  personaId: string,
  workspaceId: string,
  parentTaskId: string,
  nextRunAt: string | null,
  taskId: string | null = null,
  agentId: string | null = null,
): void {
  db.insert(schedules)
    .values({
      id,
      title,
      description,
      scheduleExpression,
      personaId,
      workspaceId,
      parentTaskId,
      nextRunAt,
      taskId,
      agentId,
    })
    .run();
}

/** Retrieve a schedule by ID. */
export function getSchedule(id: string): ScheduleRow | undefined {
  return db.select().from(schedules).where(eq(schedules.id, id)).get();
}

/**
 * List all schedules, optionally filtered by workspace.
 *
 * @param workspaceId - If provided, only return schedules in this workspace
 */
export function listSchedules(workspaceId?: string): ScheduleRow[] {
  if (workspaceId) {
    return db.select().from(schedules).where(eq(schedules.workspaceId, workspaceId)).all();
  }
  return db.select().from(schedules).all();
}

/** Update mutable fields on a schedule. Only provided fields are changed. */
export function updateSchedule(id: string, update: ScheduleUpdate): void {
  const sets: Record<string, unknown> = {
    updatedAt: sql`datetime('now')`,
  };
  if (update.title !== undefined) {
    sets.title = update.title;
  }
  if (update.description !== undefined) {
    sets.description = update.description;
  }
  if (update.scheduleExpression !== undefined) {
    sets.scheduleExpression = update.scheduleExpression;
  }
  if (update.personaId !== undefined) {
    sets.personaId = update.personaId;
  }
  if (update.enabled !== undefined) {
    sets.enabled = update.enabled;
  }
  if (update.nextRunAt !== undefined) {
    sets.nextRunAt = update.nextRunAt;
  }
  if (update.taskId !== undefined) {
    sets.taskId = update.taskId;
  }
  if (update.agentId !== undefined) {
    // Normalize empty-string detach sentinel to null so the FK constraint is
    // never violated by a stray "" caller. The handler already does this, but
    // the store is the last line of defense.
    // eslint-disable-next-line @rushstack/no-new-null
    sets.agentId = update.agentId === "" ? null : update.agentId;
  }
  db.update(schedules).set(sets).where(eq(schedules.id, id)).run();
}

/**
 * Retrieve the heartbeat schedule (if any) whose `task_id` matches.
 *
 * Used by Agent handlers to read the derived `Agent.heartbeat` field via
 * `getRootTaskForAgent → getHeartbeatForTask`, and by the cron-phase heartbeat
 * branch as part of its target-resolution path. #1438.
 */
export function getHeartbeatForTask(taskId: string): ScheduleRow | undefined {
  return db.select().from(schedules).where(eq(schedules.taskId, taskId)).get();
}

/** Delete a schedule by ID. */
export function deleteSchedule(id: string): void {
  db.delete(schedules).where(eq(schedules.id, id)).run();
}

/**
 * Return all enabled schedules whose `nextRunAt` is at or before the current time.
 * These are the schedules that should fire on the current tick.
 */
export function getDueSchedules(): ScheduleRow[] {
  const now = serverTimestamp();
  return db
    .select()
    .from(schedules)
    .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)))
    .all();
}

/**
 * Advance a schedule after a successful fire.
 *
 * @param id - Schedule ID
 * @param lastRunAt - Timestamp of this fire
 * @param nextRunAt - Pre-computed next fire time
 */
export function advanceSchedule(id: string, lastRunAt: string, nextRunAt: string): void {
  db.update(schedules)
    .set({
      lastRunAt,
      nextRunAt,
      runCount: sql`run_count + 1`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(schedules.id, id))
    .run();
}

/**
 * Enable or disable a schedule, setting or clearing `nextRunAt` accordingly.
 *
 * @param id - Schedule ID
 * @param enabled - New enabled state
 * @param nextRunAt - Next run time (non-null when enabling, null when disabling)
 */
export function setScheduleEnabled(id: string, enabled: boolean, nextRunAt: string | null): void {
  db.update(schedules)
    .set({
      enabled,
      nextRunAt,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(schedules.id, id))
    .run();
}

/**
 * Clean up all schedules owned by the given agent before the agent row is
 * deleted (called by `deleteAgent` to satisfy `PRAGMA foreign_keys ON`).
 *
 * Three distinct cases:
 * - Heartbeat schedules (`task_id IS NOT NULL`): deleted outright — their
 *   target task is being removed too, so they would be orphaned.
 * - Standalone cron schedules with an explicit `persona_id`: `agent_id` is
 *   set to null so the rows survive as unowned schedules (preserving config).
 * - Standalone cron schedules with `persona_id=""` (inherited from agent):
 *   `agent_id` is cleared AND the schedule is disabled — without an agent
 *   the cron phase cannot resolve a persona and would skip every tick,
 *   producing repeated warning logs until the schedule is reconfigured.
 */
export function detachSchedulesForAgent(agentId: string): void {
  // Delete heartbeat schedules — target task is going away.
  db.delete(schedules)
    .where(and(eq(schedules.agentId, agentId), isNotNull(schedules.taskId)))
    .run();
  // Standalone schedules with an explicit personaId — keep enabled, just lose the owner.
  db.update(schedules)
    .set({
      // eslint-disable-next-line @rushstack/no-new-null
      agentId: null,
      updatedAt: sql`datetime('now')`,
    })
    .where(
      and(eq(schedules.agentId, agentId), isNull(schedules.taskId), ne(schedules.personaId, "")),
    )
    .run();
  // Standalone schedules relying on agent's persona (personaId="") — lose the owner AND
  // are disabled; they can't resolve a persona without an agent.
  db.update(schedules)
    .set({
      // eslint-disable-next-line @rushstack/no-new-null
      agentId: null,
      enabled: false,
      // eslint-disable-next-line @rushstack/no-new-null
      nextRunAt: null,
      updatedAt: sql`datetime('now')`,
    })
    .where(
      and(eq(schedules.agentId, agentId), isNull(schedules.taskId), eq(schedules.personaId, "")),
    )
    .run();
}

const _typeCheck: ScheduleStore = {
  createSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  getHeartbeatForTask,
  deleteSchedule,
  getDueSchedules,
  advanceSchedule,
  setScheduleEnabled,
  detachSchedulesForAgent,
};
void _typeCheck;
