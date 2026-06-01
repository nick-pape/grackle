/**
 * Cron reconciliation phase — fires due schedules on each tick.
 *
 * Creates tasks for due schedules and enqueues them for dispatch.
 * The dispatch phase (separate reconciliation phase) handles starting
 * sessions, respecting concurrency limits, and environment resolution.
 */

import { v4 as uuidv4 } from "uuid";
import type { Logger } from "pino";
import { computeNextRunAt } from "./schedule-expression.js";
import type { ScheduleRow, TaskRow, SessionRow } from "@grackle-ai/database";
import type { GrackleEventType } from "@grackle-ai/core";
import type { ReconciliationPhase } from "@grackle-ai/plugin-sdk";
import { ROOT_TASK_ID, SESSION_STATUS, type SessionStatus } from "@grackle-ai/common";

/**
 * Session statuses considered "alive" — a heartbeat tick whose target task
 * has a session in any of these states is treated as overrun and skipped.
 * Complement of `TERMINAL_SESSION_STATUSES` from `@grackle-ai/common` (#1438).
 * Widened to `ReadonlySet<string>` so we can `.has(session.status)` without
 * casting at every call site — sessionStore returns raw strings.
 */
const ALIVE_SESSION_STATUSES: ReadonlySet<string> = new Set<SessionStatus>([
  SESSION_STATUS.PENDING,
  SESSION_STATUS.RUNNING,
  SESSION_STATUS.IDLE,
]);

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
  enqueueForDispatch: (entry: {
    id: string;
    taskId: string;
    environmentId?: string;
    personaId?: string;
  }) => void;
  /** Emit a domain event. */
  emit: (type: GrackleEventType, payload: Record<string, unknown>) => void;
  /** Look up a persona by ID. */
  getPersona: (id: string) => { id: string; name: string; runtime: string } | undefined;
  /** Enable or disable a schedule, setting or clearing nextRunAt. */
  // eslint-disable-next-line @rushstack/no-new-null
  setScheduleEnabled: (id: string, enabled: boolean, nextRunAt: string | null) => void;
  // ── Heartbeat branch dependencies (#1438) ──
  /** Look up a task by id (heartbeat target resolution). */
  getTask: (id: string) => TaskRow | undefined;
  /** Latest session for a task (skip-on-overrun + reanimate target). */
  getLatestSessionForTask: (taskId: string) => SessionRow | undefined;
  /** Reanimate an existing session by id. Throws on failure (env offline, no runtime id, etc). */
  reanimateAgent: (sessionId: string) => Promise<void>;
  /** Deliver raw bytes as the next user message into a live session. */
  publishToStdin: (sessionId: string, text: string) => void;
  /** Start a new session for a task (fresh-spawn fallback). Returns error string on failure. */
  startTaskSession: (
    task: TaskRow,
    options?: { personaId?: string; environmentId?: string; rawPrompt?: string },
  ) => Promise<string | undefined>;
  /** Resolve an environment id for the heartbeat fresh-spawn fallback. */
  resolveEnvironment: (task: TaskRow) => string | undefined;
  /** Logger instance provided by the plugin context. */
  logger: Pick<Logger, "debug" | "info" | "warn" | "error">;
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
      deps.logger.debug({ count: due.length }, "Cron phase: due schedules");
      for (const schedule of due) {
        await fireSchedule(deps, schedule);
      }
    },
  };
}

/**
 * Dispatch a due schedule based on whether it carries a heartbeat target
 * (`task_id` non-null). See {@link fireScheduleAsTask} for the fresh-spawn
 * path (today's behavior) and {@link fireScheduleAsHeartbeat} for #1438's
 * reanimation loop.
 */
async function fireSchedule(deps: CronPhaseDeps, schedule: ScheduleRow): Promise<void> {
  if (schedule.taskId) {
    await fireScheduleAsHeartbeat(deps, schedule);
  } else {
    fireScheduleAsTask(deps, schedule);
  }
}

/**
 * Compute the next-run timestamp for a schedule, with drift-anchored fallback.
 * On parse failure, disable the schedule and return undefined to abort the
 * tick. Shared between the heartbeat and fresh-task fire paths.
 */
function computeNextOrDisable(deps: CronPhaseDeps, schedule: ScheduleRow): string | undefined {
  try {
    return computeNextRunAt(schedule.scheduleExpression, schedule.lastRunAt ?? undefined);
  } catch (err) {
    deps.logger.error(
      { scheduleId: schedule.id, scheduleExpression: schedule.scheduleExpression, err },
      "Cron phase: failed to compute nextRunAt; disabling schedule",
    );
    deps.setScheduleEnabled(schedule.id, false, null);
    return undefined;
  }
}

/** Fire a heartbeat-style schedule (#1438): reanimate target session, or fresh-spawn. */
async function fireScheduleAsHeartbeat(deps: CronPhaseDeps, schedule: ScheduleRow): Promise<void> {
  const now = new Date().toISOString();
  const nextRunAt = computeNextOrDisable(deps, schedule);
  if (!nextRunAt) {
    return;
  }

  // The discriminator: schedule.taskId is non-null here.
  const targetTaskId = schedule.taskId!;
  const task = deps.getTask(targetTaskId);
  if (!task) {
    // Heartbeat for a deleted task — disable to prevent every-tick error loops.
    deps.logger.warn(
      { scheduleId: schedule.id, taskId: targetTaskId },
      "Heartbeat target task missing; disabling schedule",
    );
    deps.setScheduleEnabled(schedule.id, false, null);
    return;
  }

  // Skip-on-overrun: if the latest session is still alive (PENDING/RUNNING/IDLE),
  // don't fire — the previous tick hasn't finished its turn.
  const latest = deps.getLatestSessionForTask(targetTaskId);
  if (latest && ALIVE_SESSION_STATUSES.has(latest.status)) {
    deps.logger.info(
      {
        scheduleId: schedule.id,
        taskId: targetTaskId,
        sessionId: latest.id,
        status: latest.status,
      },
      "Heartbeat skipped: target session still active (overrun)",
    );
    deps.advanceSchedule(schedule.id, now, nextRunAt);
    return;
  }

  // Reanimate path: latest exists and is dead → wake it and stream the rules.
  if (latest) {
    try {
      await deps.reanimateAgent(latest.id);
      deps.publishToStdin(latest.id, schedule.description);
      deps.advanceSchedule(schedule.id, now, nextRunAt);
      deps.emit("schedule.fired", {
        scheduleId: schedule.id,
        taskId: targetTaskId,
        sessionId: latest.id,
        firedAt: now,
        mode: "reanimate",
      });
      deps.logger.info(
        { scheduleId: schedule.id, taskId: targetTaskId, sessionId: latest.id },
        "Heartbeat fired via reanimate",
      );
      return;
    } catch (err) {
      deps.logger.warn(
        { scheduleId: schedule.id, sessionId: latest.id, err },
        "Reanimate failed; falling back to fresh spawn",
      );
      // fall through to fresh-spawn
    }
  }

  // Fresh-spawn fallback. Uses #1442's `rawPrompt` to match the bytes that
  // `publishToStdin` would have delivered — so reanimate-path and spawn-path
  // produce identical first-user-message content (heartbeat invariant).
  const environmentId = deps.resolveEnvironment(task);
  const errMsg = await deps.startTaskSession(task, {
    personaId: schedule.personaId,
    environmentId,
    rawPrompt: schedule.description,
  });
  // Always advance the schedule (otherwise the same tick fires every poll
  // until success); but only emit `schedule.fired` when work actually started.
  // Mirrors {@link fireScheduleAsTask}'s emit-on-success-only behavior.
  deps.advanceSchedule(schedule.id, now, nextRunAt);
  if (errMsg) {
    deps.logger.error(
      { scheduleId: schedule.id, taskId: targetTaskId, err: errMsg },
      "Heartbeat fresh-spawn failed",
    );
    return;
  }
  deps.emit("schedule.fired", {
    scheduleId: schedule.id,
    taskId: targetTaskId,
    firedAt: now,
    mode: "fresh-spawn",
  });
}

/** Fire a fresh-task schedule (today's behavior): create new task, enqueue, advance. */
function fireScheduleAsTask(deps: CronPhaseDeps, schedule: ScheduleRow): void {
  const now = new Date().toISOString();
  const nextRunAt = computeNextOrDisable(deps, schedule);
  if (!nextRunAt) {
    return;
  }

  try {
    // Validate persona exists
    const persona = deps.getPersona(schedule.personaId);
    if (!persona) {
      deps.logger.warn(
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
    // No environmentId hint — dispatch will resolve via the workspace's linked
    // environment pool (ancestor session → linked envs load-balanced → global fallback).
    deps.enqueueForDispatch({
      id: uuidv4(),
      taskId,
      personaId: schedule.personaId,
    });

    // Advance schedule
    deps.advanceSchedule(schedule.id, now, nextRunAt);

    deps.emit("schedule.fired", {
      scheduleId: schedule.id,
      taskId,
      firedAt: now,
    });

    deps.logger.info({ scheduleId: schedule.id, taskId, title: schedule.title }, "Schedule fired");
  } catch (err) {
    deps.logger.error({ scheduleId: schedule.id, err }, "Schedule fire failed with exception");
    // Still advance to prevent retry storms
    deps.advanceSchedule(schedule.id, now, nextRunAt);
  }
}
