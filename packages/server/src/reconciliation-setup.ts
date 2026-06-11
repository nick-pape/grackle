import {
  listConnections,
  removeConnection,
  startTaskSession,
  emit,
  logger,
  hasCapacity,
  computeTaskStatus,
  resolveDispatchEnvironment,
  resolveAncestorEnvironmentId,
  findFirstConnectedEnvironment,
  interruptChildSession,
  toTaskModel,
  taskService,
} from "@grackle-ai/core";
import type { ReconciliationPhase } from "@grackle-ai/core";
import {
  createDispatchPhase,
  lifecycleCleanupPhase,
  createEnvironmentReconciliationPhase,
  createSubagentReconciliationPhase,
} from "@grackle-ai/plugin-core";
import { TASK_STATUS, ROOT_TASK_ID } from "@grackle-ai/common";
import { getDatabaseStores } from "@grackle-ai/database";

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
    listEnvironments: () => getDatabaseStores().envRegistry.listEnvironments(),
    listConnectionIds: () => new Set(listConnections().keys()),
    updateEnvironmentStatus: (id, status) =>
      getDatabaseStores().envRegistry.updateEnvironmentStatus(id, status),
    removeConnection,
    emit,
  });

  const dispatchPhase = createDispatchPhase({
    listPendingEntries: () => getDatabaseStores().dispatchQueueStore.listPending(),
    dequeueEntry: (id) => getDatabaseStores().dispatchQueueStore.dequeue(id),
    getTask: (id: string) => {
      const row = getDatabaseStores().taskStore.getTask(id);
      return row ? toTaskModel(row) : undefined;
    },
    hasCapacity: (environmentId: string): boolean => {
      const { sessionStore, envRegistry, settingsStore } = getDatabaseStores();
      return hasCapacity(environmentId, {
        countActiveForEnvironment: (envId) => sessionStore.countActiveForEnvironment(envId),
        getEnvironment: (id) => envRegistry.getEnvironment(id),
        getSetting: (key) => settingsStore.getSetting(key),
      });
    },
    environmentExists: (id: string): boolean =>
      getDatabaseStores().envRegistry.getEnvironment(id) !== undefined,
    isTaskEligible: (taskId: string): boolean => {
      if (!taskService.areDependenciesMet(taskId)) {
        return false;
      }
      const { taskStore, sessionStore } = getDatabaseStores();
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
      const env = getDatabaseStores().envRegistry.getEnvironment(id);
      return env?.status === "connected";
    },
    resolveEnvironment: (task) => {
      const resolved = resolveDispatchEnvironment(task, {
        resolveAncestorEnvironmentId,
        getLinkedEnvironmentIds: (wsId) =>
          getDatabaseStores().workspaceEnvironmentLinkStore.getLinkedEnvironmentIds(wsId),
        isEnvironmentConnected: (id) =>
          getDatabaseStores().envRegistry.getEnvironment(id)?.status === "connected",
        countActiveForEnvironment: (envId) =>
          getDatabaseStores().sessionStore.countActiveForEnvironment(envId),
        findFirstConnectedEnvironment,
      });
      if (resolved) {
        logger.debug(
          { workspaceId: task.workspaceId, environmentId: resolved },
          "Dispatch resolved environment",
        );
      }
      return resolved;
    },
  });

  const subagentReconciliationPhase = createSubagentReconciliationPhase({
    listRunningSubagentChildren: () =>
      getDatabaseStores().sessionStore.listRunningSubagentChildren(),
    getSession: (id) => getDatabaseStores().sessionStore.getSession(id),
    interruptChildSession,
  });

  const phases: ReconciliationPhase[] = [
    dispatchPhase,
    lifecycleCleanupPhase,
    subagentReconciliationPhase,
    environmentReconciliationPhase,
  ];

  return phases;
}
