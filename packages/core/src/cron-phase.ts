/**
 * Cron reconciliation phase — fires due schedules on each tick.
 *
 * Extracted from the former CronManager so it can plug into the
 * ReconciliationManager as one of several ordered phases.
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger.js";
import { computeNextRunAt } from "./schedule-expression.js";
import type { ScheduleRow, EnvironmentRow, TaskRow } from "@grackle-ai/database";
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
  /** Start a task session internally (same as root task boot listener). */
  startTaskSession: (
    ws: undefined,
    task: TaskRow,
    options?: { personaId?: string; environmentId?: string; notes?: string },
  ) => Promise<string | undefined>;
  /** Emit a domain event. */
  emit: (type: GrackleEventType, payload: Record<string, unknown>) => void;
  /** Find the first connected environment (prefers local). */
  findFirstConnectedEnvironment: () => EnvironmentRow | undefined;
  /** Look up a persona by ID. */
  getPersona: (id: string) => { id: string; name: string; runtime: string } | undefined;
  /** Look up a task by ID (to pass to startTaskSession). */
  getTask: (id: string) => TaskRow | undefined;
  /** Enable or disable a schedule, setting or clearing nextRunAt. */
  // eslint-disable-next-line @rushstack/no-new-null
  setScheduleEnabled: (id: string, enabled: boolean, nextRunAt: string | null) => void;
  /** Check if an environment is connected. */
  isEnvironmentConnected: (environmentId: string) => boolean;
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
        await fireSchedule(deps, schedule);
      }
    },
  };
}

/** Fire a single schedule: create task, start session, advance. */
async function fireSchedule(deps: CronPhaseDeps, schedule: ScheduleRow): Promise<void> {
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
    // Resolve environment — check connectivity before creating tasks to avoid orphan tasks
    let environmentId: string | undefined;
    if (schedule.environmentId) {
      // Explicit environment: verify it's connected before creating a task
      if (!deps.isEnvironmentConnected(schedule.environmentId)) {
        logger.warn(
          { scheduleId: schedule.id, environmentId: schedule.environmentId },
          "Schedule fire skipped: specified environment not connected",
        );
        deps.advanceSchedule(schedule.id, now, nextRunAt);
        return;
      }
      environmentId = schedule.environmentId;
    } else {
      // Auto-select first connected environment
      const env = deps.findFirstConnectedEnvironment();
      if (!env) {
        logger.warn(
          { scheduleId: schedule.id },
          "Schedule fire skipped: no connected environment",
        );
        deps.advanceSchedule(schedule.id, now, nextRunAt);
        return;
      }
      environmentId = env.id;
    }

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

    // Fetch the created task for startTaskSession
    const task = deps.getTask(taskId);
    if (!task) {
      logger.error(
        { scheduleId: schedule.id, taskId },
        "Schedule fire failed: created task not found",
      );
      deps.advanceSchedule(schedule.id, now, nextRunAt);
      return;
    }

    // Start the task session
    const error = await deps.startTaskSession(undefined, task, {
      environmentId,
      personaId: schedule.personaId,
    });

    // Advance schedule regardless of session start outcome
    deps.advanceSchedule(schedule.id, now, nextRunAt);

    if (error) {
      logger.warn(
        { scheduleId: schedule.id, taskId, error },
        "Schedule fire: task created but session start failed",
      );
      return;
    }

    // Emit event only on successful fire
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
