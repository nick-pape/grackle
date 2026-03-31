/**
 * Orchestration plugin — contributes task, persona, finding, and escalation
 * gRPC handlers, orphan-reparent reconciliation, and sigchld/escalation/orphan
 * event subscribers.
 *
 * @module
 */

import type { GracklePlugin } from "@grackle-ai/plugin-sdk";
import { grackle } from "@grackle-ai/common";
import { emit } from "@grackle-ai/core";
import {
  createOrchestrationCollector,
  createOrphanPhase,
  createSigchldSubscriber, createEscalationAutoSubscriber, createOrphanReparentSubscriber,
} from "@grackle-ai/plugin-core";
import { taskStore, workspaceStore } from "@grackle-ai/database";

/**
 * Create the orchestration plugin that contributes task/persona/finding/escalation
 * capabilities to the Grackle server.
 *
 * - **gRPC handlers**: All 21 orchestration RPCs (tasks, personas, findings, escalations)
 * - **Reconciliation phases**: orphan-reparent
 * - **Event subscribers**: sigchld, escalation-auto, orphan-reparent
 *
 * Depends on the "core" plugin.
 *
 * @returns A GracklePlugin ready to pass to `loadPlugins()`.
 */
export function createOrchestrationPlugin(): GracklePlugin {
  return {
    name: "orchestration",
    dependencies: ["core"],

    grpcHandlers: () => [{
      service: grackle.Grackle,
      handlers: createOrchestrationCollector().getHandlers(grackle.Grackle),
    }],

    reconciliationPhases: () => [
      createOrphanPhase({
        listAllTasks: () => {
          const workspaces = workspaceStore.listWorkspaces();
          const allTasks: Array<NonNullable<ReturnType<typeof taskStore.listTasks>[number]>> = [];
          for (const ws of workspaces) {
            allTasks.push(...taskStore.listTasks(ws.id));
          }
          return allTasks;
        },
        reparentTask: (taskId: string, newParentTaskId: string): void => {
          taskStore.reparentTask(taskId, newParentTaskId);
        },
        emit,
      }),
    ],

    eventSubscribers: (ctx) => [
      createSigchldSubscriber(ctx),
      createEscalationAutoSubscriber(ctx),
      createOrphanReparentSubscriber(ctx),
    ],
  };
}
