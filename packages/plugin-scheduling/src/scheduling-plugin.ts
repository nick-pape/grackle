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
  scheduleStore, taskStore, personaStore, dispatchQueueStore,
} from "@grackle-ai/database";
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

    grpcHandlers: (ctx: PluginContext) => [{
      service: grackle.Grackle,
      handlers: createScheduleHandlers(ctx.emit),
    }],

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
        logger: ctx.logger,
      }),
    ],
  };
}
