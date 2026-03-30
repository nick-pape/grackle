/**
 * Cron reconciliation phase — fires due schedules on each tick.
 *
 * Creates tasks for due schedules and enqueues them for dispatch.
 * The dispatch phase (separate reconciliation phase) handles starting
 * sessions, respecting concurrency limits, and environment resolution.
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger.js";
import { computeNextRunAt } from "./schedule-expression.js";
import type { ScheduleRow } from "@grackle-ai/database";
import type { GrackleEventType } from "./event-bus.js";
import type { ReconciliationPhase } from "./reconciliation-manager.js";
import { ROOT_TASK_ID } from "@grackle-ai/common";

/** Dependencies injected into the cron phase for testability. */
export interface CronPhaseDeps {
  /** Query the schedule store for due entries. */
  getDueSchedules: () => ScheduleRow[];
  /** Advance a schedule after firing (update lastRunAt, nextRunAt, runCount). */
  advanceSchedule: (id: string, lastRunAt: string, nextRunAt: string) => void;
  /** Create a new task in the task store. */
  createTask: (
    id: string,
    workspaceId: string | undefined,
    title: string,
    description: string,
    dependsOn: string[],
    workspaceSlug: string,
    parentTaskId?: string,
    canDecompose?: boolean,
    defaultPersonaId?: string,
  ) => void;
  /** Set the schedule_id FK on a task. */
  setTaskScheduleId: (taskId: string, scheduleId: string) => void;
  /** Enqueue a task for the dispatch phase to start. */
  enqueueForDispatch: (entry: { id: string; taskId: string; environmentId?: string; personaId?: string }) => void;
  /** Emit a domain event. */
  emit: (type: GrackleEventType, payload: Record<string, unknown>) => void;
  /** Look up a persona by ID. */
  getPersona: (id: string) => { id: string; name: string; runtime: string } | undefined;
  /** Enable or disable a schedule, setting or clearing nextRunAt. */
  // eslint-disable-next-line @rushstack/no-new-null
  setScheduleEnabled: (id: string, enabled: boolean, nextRunAt: string | null) => void;
}

/**
 * Create a ReconciliationPhase that fires due schedules.
 *
 * @param deps - Injected dependencies
 * @returns A phase to register with ReconciliationManager
 */
export function createCronPhase(deps: CronPhaseDeps): ReconciliationPhase {
  return {
    name: "cron",
    execute: async () => {
      const due = deps.getDueSchedules();
      if (due.length === 0) {
        return;
      }
      logger.debug({ count: due.length }, "Cron phase: due schedules");
      for (const schedule of due) {
        fireSchedule(deps, schedule);
      }
    },
  };
}

/** Fire a single schedule: create task, enqueue for dispatch, advance. */
function fireSchedule(deps: CronPhaseDeps, schedule: ScheduleRow): void {
  const now = new Date().toISOString();

  let nextRunAt: string;
  try {
    // Anchor to the schedule's lastRunAt (not current time) to prevent drift
    nextRunAt = computeNextRunAt(schedule.scheduleExpression, schedule.lastRunAt ?? undefined);
  } catch (err) {
    logger.error(
      { scheduleId: schedule.id, scheduleExpression: schedule.scheduleExpression, err },
      "Cron phase: failed to compute nextRunAt; disabling schedule",
    );
    // Disable the schedule to prevent error loop on every tick
    deps.setScheduleEnabled(schedule.id, false, null);
    return;
  }

  try {
    // Validate persona exists
    const persona = deps.getPersona(schedule.personaId);
    if (!persona) {
      logger.warn(
        { scheduleId: schedule.id, personaId: schedule.personaId },
        "Schedule fire skipped: persona not found",
      );
      deps.advanceSchedule(schedule.id, now, nextRunAt);
      return;
    }

    // Create task
    const taskId = uuidv4();
    const taskTitle = `${schedule.title} @ ${now}`;
    const parentTaskId = schedule.parentTaskId || ROOT_TASK_ID;
    deps.createTask(
      taskId,
      schedule.workspaceId || undefined,
      taskTitle,
      schedule.description,
      [], // no dependencies
      "", // no workspace slug
      parentTaskId,
      false, // canDecompose
      schedule.personaId,
    );
    deps.setTaskScheduleId(taskId, schedule.id);

    // Enqueue for the dispatch phase to start (respects concurrency limits).
    // Environment resolution is handled by the dispatch phase; we pass the
    // schedule's preferred environmentId as a hint.
    deps.enqueueForDispatch({
      id: uuidv4(),
      taskId,
      environmentId: schedule.environmentId || undefined,
      personaId: schedule.personaId,
    });

    // Advance schedule
    deps.advanceSchedule(schedule.id, now, nextRunAt);

    deps.emit("schedule.fired", {
      scheduleId: schedule.id,
      taskId,
      firedAt: now,
    });

    logger.info(
      { scheduleId: schedule.id, taskId, title: schedule.title },
      "Schedule fired",
    );
  } catch (err) {
    logger.error(
      { scheduleId: schedule.id, err },
      "Schedule fire failed with exception",
    );
    // Still advance to prevent retry storms
    deps.advanceSchedule(schedule.id, now, nextRunAt);
  }
}
