import {
  listConnections, removeConnection,
  isKnowledgeEnabled, createKnowledgeHealthPhase, neo4jHealthCheck,
  startTaskSession, emit,
  hasCapacity, computeTaskStatus,
} from "@grackle-ai/core";
import type { ReconciliationPhase } from "@grackle-ai/core";
import {
  createCronPhase, createOrphanPhase, createDispatchPhase, lifecycleCleanupPhase,
  createEnvironmentReconciliationPhase,
} from "@grackle-ai/plugin-core";
import { TASK_STATUS, ROOT_TASK_ID } from "@grackle-ai/common";
import {
  scheduleStore, taskStore, workspaceStore, personaStore, envRegistry,
  sessionStore, settingsStore, dispatchQueueStore,
} from "@grackle-ai/database";

/**
 * Assemble the ordered list of reconciliation phases for the server.
 *
 * Returns dispatch, cron, lifecycle-cleanup, orphan-reparent, and environment-reconciliation
 * phases (in that order). When the knowledge subsystem is enabled, a knowledge-health
 * phase is appended.
 *
 * @returns An array of phases to pass to {@link ReconciliationManager}.
 */
export function createReconciliationPhases(): ReconciliationPhase[] {
  const cronPhase = createCronPhase({
    getDueSchedules: scheduleStore.getDueSchedules,
    advanceSchedule: scheduleStore.advanceSchedule,
    createTask: taskStore.createTask,
    setTaskScheduleId: taskStore.setTaskScheduleId,
    enqueueForDispatch: dispatchQueueStore.enqueue,
    emit,
    getPersona: personaStore.getPersona,
    setScheduleEnabled: scheduleStore.setScheduleEnabled,
  });

  const orphanPhase = createOrphanPhase({
    listAllTasks: () => {
      const workspaces = workspaceStore.listWorkspaces();
      const allTasks: Array<NonNullable<ReturnType<typeof taskStore.getTask>>> = [];
      for (const ws of workspaces) {
        allTasks.push(...taskStore.listTasks(ws.id));
      }
      return allTasks;
    },
    reparentTask: (taskId: string, newParentTaskId: string) =>
      taskStore.reparentTask(taskId, newParentTaskId),
    emit,
  });

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
  });

  const phases: ReconciliationPhase[] = [dispatchPhase, cronPhase, lifecycleCleanupPhase, orphanPhase, environmentReconciliationPhase];

  if (isKnowledgeEnabled()) {
    phases.push(
      createKnowledgeHealthPhase({ healthCheck: neo4jHealthCheck }),
    );
  }

  return phases;
}
