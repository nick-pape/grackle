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
import type { ScheduleRow, SessionRow } from "@grackle-ai/database";
import type { GrackleEventType, TaskModel, CreateTaskParams } from "@grackle-ai/core";
import type { ReconciliationPhase } from "@grackle-ai/plugin-sdk";
import {
  ROOT_TASK_ID,
  SESSION_STATUS,
  type SessionStatus,
  serverTimestamp,
} from "@grackle-ai/common";

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
  /** Create a new task via the task service. */
  createTask: (params: CreateTaskParams) => unknown;
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
  // ── Agent-owned schedule dependencies (#1439) ──
  /**
   * Look up an Agent by id. Returns the minimal shape needed by the cron phase
   * (primary persona for persona inheritance). Undefined = agent deleted.
   */
  getAgent: (id: string) => { primaryPersonaId: string } | undefined;
  /**
   * Look up the root task for an Agent. Returns undefined when the Agent exists
   * but has no root task (should not occur in practice after #1418; treated as a
   * misconfigured schedule → disable).
   */
  getRootTaskForAgent: (agentId: string) => TaskModel | undefined;
  // ── Heartbeat branch dependencies (#1438) ──
  /** Look up a task by id (heartbeat target resolution). */
  getTask: (id: string) => TaskModel | undefined;
  /** Latest session for a task (skip-on-overrun + reanimate target). */
  getLatestSessionForTask: (taskId: string) => SessionRow | undefined;
  /**
   * Reanimate an existing session by id. Throws on failure (env offline, no
   * runtime id, etc). Return value is ignored — typed `unknown` so the real
   * sync `reanimateAgent` from `@grackle-ai/core` (which returns `SessionRow`)
   * can be passed directly without a Promise-wrapping shim. The cron-phase
   * awaits the call so it works for both sync and async implementations.
   */
  reanimateAgent: (sessionId: string) => unknown;
  /** Deliver raw bytes as the next user message into a live session. */
  publishToStdin: (sessionId: string, text: string) => void;
  /** Start a new session for a task (fresh-spawn fallback). Returns error string on failure. */
  startTaskSession: (
    task: TaskModel,
    options?: { personaId?: string; environmentId?: string; rawPrompt?: string },
  ) => Promise<string | undefined>;
  /** Resolve an environment id for the heartbeat fresh-spawn fallback. */
  resolveEnvironment: (task: TaskModel) => string | undefined;
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
  const now = serverTimestamp();
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

/**
 * Resolve the effective persona id for a schedule fire.
 *
 * When the schedule has an explicit `personaId`, that always wins. When the
 * schedule is agent-owned and `personaId` is empty, the agent's primary persona
 * is inherited. Returns undefined when no persona can be resolved (fire skipped).
 */
function resolveEffectivePersonaId(deps: CronPhaseDeps, schedule: ScheduleRow): string | undefined {
  if (schedule.personaId) {
    return schedule.personaId;
  }
  if (schedule.agentId) {
    const agent = deps.getAgent(schedule.agentId);
    return agent?.primaryPersonaId || undefined;
  }
  return undefined;
}

/**
 * Fire a fresh-task schedule: create new task, enqueue, advance.
 *
 * When `schedule.agentId` is set (#1439) the fire-task carries `agent_id` +
 * `kind=schedule_fire` and parents under the Agent's root task so it appears
 * in the Agent's task tree. Persona is inherited from the Agent when the
 * schedule carries no explicit `personaId`. Unowned schedules behave exactly
 * as before.
 */
function fireScheduleAsTask(deps: CronPhaseDeps, schedule: ScheduleRow): void {
  const now = serverTimestamp();
  const nextRunAt = computeNextOrDisable(deps, schedule);
  if (!nextRunAt) {
    return;
  }

  try {
    // Resolve effective persona (explicit schedule override > agent primary > none).
    const effectivePersonaId = resolveEffectivePersonaId(deps, schedule);
    if (!effectivePersonaId) {
      deps.logger.warn(
        { scheduleId: schedule.id, agentId: schedule.agentId },
        "Schedule fire skipped: no persona resolved (schedule has no explicit personaId and agent primary persona is unavailable or agent record is missing)",
      );
      deps.advanceSchedule(schedule.id, now, nextRunAt);
      return;
    }

    // Validate the resolved persona exists.
    const persona = deps.getPersona(effectivePersonaId);
    if (!persona) {
      deps.logger.warn(
        { scheduleId: schedule.id, personaId: effectivePersonaId },
        "Schedule fire skipped: persona not found",
      );
      deps.advanceSchedule(schedule.id, now, nextRunAt);
      return;
    }

    // Determine parent task: agent-owned fires parent under the Agent root (#1439);
    // unowned fires use the schedule's parentTaskId (or ROOT_TASK_ID).
    let parentTaskId: string;
    let agentId: string | undefined;
    let taskKind: string | undefined;

    if (schedule.agentId) {
      const agentRoot = deps.getRootTaskForAgent(schedule.agentId);
      if (!agentRoot) {
        // Agent or its root task was deleted — disable to prevent every-tick error loops.
        deps.logger.warn(
          { scheduleId: schedule.id, agentId: schedule.agentId },
          "Agent-owned schedule fire skipped: agent root task missing; disabling schedule",
        );
        deps.setScheduleEnabled(schedule.id, false, null);
        return;
      }
      parentTaskId = agentRoot.id;
      agentId = schedule.agentId;
      taskKind = "schedule_fire";
    } else {
      parentTaskId = schedule.parentTaskId || ROOT_TASK_ID;
    }

    // Create task
    const taskId = uuidv4();
    const taskTitle = `${schedule.title} @ ${now}`;
    deps.createTask({
      id: taskId,
      workspaceId: schedule.workspaceId || undefined,
      title: taskTitle,
      description: schedule.description,
      dependsOn: [],
      parentTaskId,
      canDecompose: false,
      defaultPersonaId: effectivePersonaId,
      agentId,
      kind: taskKind,
    });
    deps.setTaskScheduleId(taskId, schedule.id);

    // Enqueue for the dispatch phase to start (respects concurrency limits).
    // No environmentId hint — dispatch will resolve via the workspace's linked
    // environment pool (ancestor session → linked envs load-balanced → global fallback).
    deps.enqueueForDispatch({
      id: uuidv4(),
      taskId,
      personaId: effectivePersonaId,
    });

    // Advance schedule
    deps.advanceSchedule(schedule.id, now, nextRunAt);

    deps.emit("schedule.fired", {
      scheduleId: schedule.id,
      taskId,
      firedAt: now,
      ...(agentId ? { agentId } : {}),
    });

    deps.logger.info(
      { scheduleId: schedule.id, taskId, title: schedule.title, agentId },
      "Schedule fired",
    );
  } catch (err) {
    deps.logger.error({ scheduleId: schedule.id, err }, "Schedule fire failed with exception");
    // Still advance to prevent retry storms
    deps.advanceSchedule(schedule.id, now, nextRunAt);
  }
}
