import {
  listConnections, removeConnection,
  startTaskSession, emit, logger,
  hasCapacity, computeTaskStatus,
  resolveDispatchEnvironment, resolveAncestorEnvironmentId, findFirstConnectedEnvironment,
} from "@grackle-ai/core";
import type { ReconciliationPhase } from "@grackle-ai/core";
import {
  createDispatchPhase, lifecycleCleanupPhase,
  createEnvironmentReconciliationPhase,
} from "@grackle-ai/plugin-core";
import { TASK_STATUS, ROOT_TASK_ID } from "@grackle-ai/common";
import {
  taskStore, workspaceStore, envRegistry,
  sessionStore, settingsStore, dispatchQueueStore, workspaceEnvironmentLinkStore,
} from "@grackle-ai/database";

/**
 * Assemble the ordered list of core reconciliation phases for the server.
 *
 * Returns dispatch, lifecycle-cleanup, and environment-reconciliation phases
 * (in that order). The cron phase is contributed by the scheduling plugin.
 * The orphan-reparent phase is contributed by the orchestration plugin.
 * The knowledge-health phase is contributed by the knowledge plugin.
 *
 * @returns An array of phases to pass to {@link ReconciliationManager}.
 */
export function createCoreReconciliationPhases(): ReconciliationPhase[] {
  const environmentReconciliationPhase = createEnvironmentReconciliationPhase({
    listEnvironments: envRegistry.listEnvironments,
    listConnectionIds: () => new Set(listConnections().keys()),
    updateEnvironmentStatus: envRegistry.updateEnvironmentStatus,
    removeConnection,
    emit,
  });

  const dispatchPhase = createDispatchPhase({
    listPendingEntries: dispatchQueueStore.listPending,
    dequeueEntry: dispatchQueueStore.dequeue,
    getTask: taskStore.getTask,
    hasCapacity: (environmentId: string): boolean => hasCapacity(environmentId, {
      countActiveForEnvironment: sessionStore.countActiveForEnvironment,
      getEnvironment: (id) => envRegistry.getEnvironment(id),
      getSetting: settingsStore.getSetting,
    }),
    environmentExists: (id: string): boolean => envRegistry.getEnvironment(id) !== undefined,
    isTaskEligible: (taskId: string): boolean => {
      if (!taskStore.areDependenciesMet(taskId)) {
        return false;
      }
      const task = taskStore.getTask(taskId);
      if (!task) {
        return false;
      }
      // Use full session history (not just active) so computeTaskStatus can
      // correctly distinguish paused/complete/failed from not_started.
      const sessions = sessionStore.listSessionsForTask(taskId);
      const { status } = computeTaskStatus(task.status, sessions);
      // Root task can restart from any non-WORKING state (matches startTask handler)
      if (taskId === ROOT_TASK_ID) {
        return status !== TASK_STATUS.WORKING;
      }
      return status === TASK_STATUS.NOT_STARTED || status === TASK_STATUS.FAILED;
    },
    startTaskSession,
    isEnvironmentConnected: (id: string): boolean => {
      const env = envRegistry.getEnvironment(id);
      return env?.status === "connected";
    },
    resolveEnvironment: (task) => {
      const resolved = resolveDispatchEnvironment(task, {
        resolveAncestorEnvironmentId,
        getWorkspace: workspaceStore.getWorkspace,
        getLinkedEnvironmentIds: workspaceEnvironmentLinkStore.getLinkedEnvironmentIds,
        isEnvironmentConnected: (id) => envRegistry.getEnvironment(id)?.status === "connected",
        countActiveForEnvironment: sessionStore.countActiveForEnvironment,
        findFirstConnectedEnvironment,
      });
      if (resolved) {
        logger.debug({ workspaceId: task.workspaceId, environmentId: resolved }, "Dispatch resolved environment");
      }
      return resolved;
    },
  });

  const phases: ReconciliationPhase[] = [dispatchPhase, lifecycleCleanupPhase, environmentReconciliationPhase];

  return phases;
}
