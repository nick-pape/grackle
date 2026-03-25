import db from "./db.js";
import { schedules, type ScheduleRow } from "./schema.js";
import { eq, and, lte, sql } from "drizzle-orm";

export type { ScheduleRow };

/** Fields that can be updated on a schedule. */
export interface ScheduleUpdate {
  title?: string;
  description?: string;
  scheduleExpression?: string;
  personaId?: string;
  environmentId?: string;
  enabled?: boolean;
  nextRunAt?: string | null;
}

/**
 * Create a new schedule entry.
 *
 * @param id - Unique schedule ID
 * @param title - Human-readable title
 * @param description - Optional description
 * @param scheduleExpression - Interval shorthand or cron expression
 * @param personaId - Persona to use when firing
 * @param environmentId - Optional environment override (empty = auto-select)
 * @param workspaceId - Optional workspace scope (empty = system-level)
 * @param parentTaskId - Parent task for spawned children (empty = ROOT_TASK_ID)
 * @param nextRunAt - Pre-computed next fire time (null if disabled)
 */
export function createSchedule(
  id: string,
  title: string,
  description: string,
  scheduleExpression: string,
  personaId: string,
  environmentId: string,
  workspaceId: string,
  parentTaskId: string,
  nextRunAt: string | null,
): void {
  db.insert(schedules)
    .values({
      id,
      title,
      description,
      scheduleExpression,
      personaId,
      environmentId,
      workspaceId,
      parentTaskId,
      nextRunAt,
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
    return db
      .select()
      .from(schedules)
      .where(eq(schedules.workspaceId, workspaceId))
      .all();
  }
  return db.select().from(schedules).all();
}

/** Update mutable fields on a schedule. Only provided fields are changed. */
export function updateSchedule(id: string, update: ScheduleUpdate): void {
  const sets: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
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
  if (update.environmentId !== undefined) {
    sets.environmentId = update.environmentId;
  }
  if (update.enabled !== undefined) {
    sets.enabled = update.enabled;
  }
  if (update.nextRunAt !== undefined) {
    sets.nextRunAt = update.nextRunAt;
  }
  db.update(schedules).set(sets).where(eq(schedules.id, id)).run();
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
  const now = new Date().toISOString();
  return db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.enabled, true),
        lte(schedules.nextRunAt, now),
      ),
    )
    .all();
}

/**
 * Advance a schedule after a successful fire.
 *
 * @param id - Schedule ID
 * @param lastRunAt - Timestamp of this fire
 * @param nextRunAt - Pre-computed next fire time
 */
export function advanceSchedule(
  id: string,
  lastRunAt: string,
  nextRunAt: string,
): void {
  db.update(schedules)
    .set({
      lastRunAt,
      nextRunAt,
      runCount: sql`run_count + 1`,
      updatedAt: new Date().toISOString(),
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
export function setScheduleEnabled(
  id: string,
  enabled: boolean,
  nextRunAt: string | null,
): void {
  db.update(schedules)
    .set({
      enabled,
      nextRunAt,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schedules.id, id))
    .run();
}
