/**
 * Scheduling plugin — contributes schedule CRUD handlers and the cron
 * reconciliation phase to the Grackle server.
 *
 * Declares `dependencies: ["core"]` so core handlers are registered first.
 *
 * @module
 */

import type { GracklePlugin, PluginContext } from "@grackle-ai/plugin-sdk";
import { registerPlugin } from "@grackle-ai/plugin-sdk";
import { grackle } from "@grackle-ai/common";
import { getDatabaseStores } from "@grackle-ai/database";
import {
  findFirstConnectedEnvironment,
  reanimateAgent,
  publishToStdin,
  startTaskSession,
  toTaskModel,
  taskService,
  type TaskModel,
} from "@grackle-ai/core";
import { createScheduleHandlers } from "./schedule-handlers.js";
import { createCronPhase } from "./cron-phase.js";

/**
 * Resolve the environment for a heartbeat fresh-spawn fallback (#1438).
 *
 * Heartbeats target Agent root tasks; the natural environment is the Agent's
 * home environment (#1418). Falls back to the first connected environment
 * when the agent has no home env (or no agent at all — generalized for
 * future task-heartbeat callers).
 *
 * Exported so it can be unit tested directly (the cron-phase deps pass it as
 * `resolveEnvironment`, without a wrapper arrow).
 */
export function resolveEnvironmentForHeartbeat(task: TaskModel): string | undefined {
  if (task.agentId) {
    const { agentStore } = getDatabaseStores();
    const agent = agentStore.getAgent(task.agentId);
    if (agent?.environmentId) {
      return agent.environmentId;
    }
  }
  return findFirstConnectedEnvironment()?.id;
}

/**
 * Create the scheduling plugin that contributes schedule CRUD and cron phase.
 *
 * @returns A GracklePlugin ready to pass to `loadPlugins()`.
 */
registerPlugin({
  name: "scheduling",
  description: "Scheduled triggers — cron and interval-based task automation",
  required: false,
  defaultEnabled: true,
  envOverride: { variable: "GRACKLE_SKIP_SCHEDULING", semantics: "skip" },
  create: createSchedulingPlugin,
});

export function createSchedulingPlugin(): GracklePlugin {
  return {
    name: "scheduling",
    dependencies: ["core"],

    grpcHandlers: (ctx: PluginContext) => [
      {
        service: grackle.GrackleScheduling,
        handlers: createScheduleHandlers(ctx.emit),
      },
    ],

    reconciliationPhases: (ctx: PluginContext) => {
      const { scheduleStore, taskStore, personaStore, dispatchQueueStore, sessionStore } =
        getDatabaseStores();
      return [
        createCronPhase({
          getDueSchedules: scheduleStore.getDueSchedules,
          advanceSchedule: scheduleStore.advanceSchedule,
          createTask: taskService.createTask,
          setTaskScheduleId: taskStore.setTaskScheduleId,
          enqueueForDispatch: dispatchQueueStore.enqueue,
          emit: ctx.emit,
          getPersona: personaStore.getPersona,
          setScheduleEnabled: scheduleStore.setScheduleEnabled,
          // Heartbeat branch wiring (#1438). `reanimateAgent` is sync (returns
          // SessionRow); the CronPhaseDep type accepts `unknown` so it can be
          // passed directly without an async wrapper.
          getTask: (id: string) => {
            const row = taskStore.getTask(id);
            return row ? toTaskModel(row) : undefined;
          },
          getLatestSessionForTask: sessionStore.getLatestSessionForTask,
          reanimateAgent,
          publishToStdin,
          startTaskSession,
          resolveEnvironment: resolveEnvironmentForHeartbeat,
          logger: ctx.logger,
        }),
      ];
    },
  };
}
