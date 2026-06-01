/**
 * Scheduling plugin — contributes schedule CRUD handlers and the cron
 * reconciliation phase to the Grackle server.
 *
 * Declares `dependencies: ["core"]` so core handlers are registered first.
 *
 * @module
 */

import type { GracklePlugin, PluginContext } from "@grackle-ai/plugin-sdk";
import { grackle } from "@grackle-ai/common";
import {
  scheduleStore,
  taskStore,
  personaStore,
  agentStore,
  sessionStore,
  dispatchQueueStore,
} from "@grackle-ai/database";
import {
  findFirstConnectedEnvironment,
  reanimateAgent,
  publishToStdin,
  startTaskSession,
} from "@grackle-ai/core";
import { createScheduleHandlers } from "./schedule-handlers.js";
import { createCronPhase } from "./cron-phase.js";

/**
 * Create the scheduling plugin that contributes schedule CRUD and cron phase.
 *
 * @returns A GracklePlugin ready to pass to `loadPlugins()`.
 */
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

    reconciliationPhases: (ctx: PluginContext) => [
      createCronPhase({
        getDueSchedules: scheduleStore.getDueSchedules,
        advanceSchedule: scheduleStore.advanceSchedule,
        createTask: taskStore.createTask,
        setTaskScheduleId: taskStore.setTaskScheduleId,
        enqueueForDispatch: dispatchQueueStore.enqueue,
        emit: ctx.emit,
        getPersona: personaStore.getPersona,
        setScheduleEnabled: scheduleStore.setScheduleEnabled,
        // Heartbeat branch wiring (#1438)
        getTask: taskStore.getTask,
        getLatestSessionForTask: sessionStore.getLatestSessionForTask,
        reanimateAgent: async (sessionId: string) => {
          await reanimateAgent(sessionId);
        },
        publishToStdin,
        startTaskSession,
        resolveEnvironment: (task) => {
          // Heartbeats target Agent root tasks; the natural environment is the
          // Agent's home environment (#1418). Fall back to first-connected if
          // the agent or env can't be resolved.
          if (task.agentId) {
            const agent = agentStore.getAgent(task.agentId);
            if (agent?.environmentId) {
              return agent.environmentId;
            }
          }
          return findFirstConnectedEnvironment()?.id;
        },
        logger: ctx.logger,
      }),
    ],
  };
}
