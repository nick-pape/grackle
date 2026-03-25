/**
 * CronManager — periodic ticker that fires due schedules.
 *
 * Runs as a background interval on the server, checking the schedule store
 * for due entries on each tick and spawning tasks for them.
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger.js";
import { computeNextRunAt } from "./schedule-expression.js";
import type { ScheduleRow, EnvironmentRow, TaskRow } from "@grackle-ai/database";
import type { GrackleEventType } from "./event-bus.js";
import { ROOT_TASK_ID } from "@grackle-ai/common";

/** Default tick interval in milliseconds. */
const DEFAULT_CHECK_INTERVAL_MS: number = 10_000;

/** Dependencies injected into CronManager for testability (NFR-4). */
export interface CronManagerDeps {
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
 * Periodic cron manager that checks for due schedules and fires them.
 */
export class CronManager {
  private readonly deps: CronManagerDeps;
  private readonly checkIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking: boolean = false;
  private tickPromise: Promise<void> | undefined;

  /**
   * @param deps - Injected dependencies
   * @param checkIntervalMs - How often to check for due schedules (default 10s)
   */
  public constructor(deps: CronManagerDeps, checkIntervalMs?: number) {
    this.deps = deps;
    this.checkIntervalMs = checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  }

  /** Start the periodic ticker. */
  public start(): void {
    if (this.timer) {
      return;
    }
    logger.info(
      { intervalMs: this.checkIntervalMs },
      "CronManager started",
    );
    this.timer = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.tryTick();
    }, this.checkIntervalMs);
    this.timer.unref();
  }

  /** Stop the ticker and await any in-flight tick. */
  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.tickPromise) {
      await this.tickPromise;
    }
    logger.info("CronManager stopped");
  }

  /** Attempt a tick, skipping if a previous tick is still in-flight. */
  private async tryTick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    this.tickPromise = this.tick();
    try {
      await this.tickPromise;
    } catch (err) {
      logger.error({ err }, "CronManager tick failed");
    } finally {
      this.ticking = false;
      this.tickPromise = undefined;
    }
  }

  /** Execute one tick: query due schedules and fire each. */
  private async tick(): Promise<void> {
    const due = this.deps.getDueSchedules();
    if (due.length === 0) {
      return;
    }
    logger.debug({ count: due.length }, "CronManager tick: due schedules");
    for (const schedule of due) {
      await this.fireSchedule(schedule);
    }
  }

  /** Fire a single schedule: create task, start session, advance. */
  private async fireSchedule(schedule: ScheduleRow): Promise<void> {
    const now = new Date().toISOString();

    let nextRunAt: string;
    try {
      // Anchor to the schedule's lastRunAt (not current time) to prevent drift
      nextRunAt = computeNextRunAt(schedule.scheduleExpression, schedule.lastRunAt ?? undefined);
    } catch (err) {
      logger.error(
        { scheduleId: schedule.id, scheduleExpression: schedule.scheduleExpression, err },
        "CronManager: failed to compute nextRunAt; disabling schedule",
      );
      // Disable the schedule to prevent error loop on every tick
      this.deps.setScheduleEnabled(schedule.id, false, null);
      return;
    }

    try {
      // Resolve environment — check connectivity before creating tasks to avoid orphan tasks
      let environmentId: string | undefined;
      if (schedule.environmentId) {
        // Explicit environment: verify it's connected before creating a task
        if (!this.deps.isEnvironmentConnected(schedule.environmentId)) {
          logger.warn(
            { scheduleId: schedule.id, environmentId: schedule.environmentId },
            "Schedule fire skipped: specified environment not connected",
          );
          this.deps.advanceSchedule(schedule.id, now, nextRunAt);
          return;
        }
        environmentId = schedule.environmentId;
      } else {
        // Auto-select first connected environment
        const env = this.deps.findFirstConnectedEnvironment();
        if (!env) {
          logger.warn(
            { scheduleId: schedule.id },
            "Schedule fire skipped: no connected environment",
          );
          this.deps.advanceSchedule(schedule.id, now, nextRunAt);
          return;
        }
        environmentId = env.id;
      }

      // Validate persona exists
      const persona = this.deps.getPersona(schedule.personaId);
      if (!persona) {
        logger.warn(
          { scheduleId: schedule.id, personaId: schedule.personaId },
          "Schedule fire skipped: persona not found",
        );
        this.deps.advanceSchedule(schedule.id, now, nextRunAt);
        return;
      }

      // Create task
      const taskId = uuidv4();
      const taskTitle = `${schedule.title} @ ${now}`;
      const parentTaskId = schedule.parentTaskId || ROOT_TASK_ID;
      this.deps.createTask(
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
      this.deps.setTaskScheduleId(taskId, schedule.id);

      // Fetch the created task for startTaskSession
      const task = this.deps.getTask(taskId);
      if (!task) {
        logger.error(
          { scheduleId: schedule.id, taskId },
          "Schedule fire failed: created task not found",
        );
        this.deps.advanceSchedule(schedule.id, now, nextRunAt);
        return;
      }

      // Start the task session
      const error = await this.deps.startTaskSession(undefined, task, {
        environmentId,
        personaId: schedule.personaId,
      });

      // Advance schedule regardless of session start outcome
      this.deps.advanceSchedule(schedule.id, now, nextRunAt);

      if (error) {
        logger.warn(
          { scheduleId: schedule.id, taskId, error },
          "Schedule fire: task created but session start failed",
        );
        return;
      }

      // Emit event only on successful fire
      this.deps.emit("schedule.fired", {
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
      this.deps.advanceSchedule(schedule.id, now, nextRunAt);
    }
  }
}
