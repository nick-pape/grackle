import {
  createCronPhase, createOrphanPhase, lifecycleCleanupPhase,
  isKnowledgeEnabled, createKnowledgeHealthPhase, neo4jHealthCheck,
  startTaskSession, emit, findFirstConnectedEnvironment,
} from "@grackle-ai/core";
import type { ReconciliationPhase } from "@grackle-ai/core";
import {
  scheduleStore, taskStore, workspaceStore, personaStore, envRegistry,
} from "@grackle-ai/database";

/**
 * Assemble the ordered list of reconciliation phases for the server.
 *
 * Returns cron, lifecycle-cleanup, and orphan-reparent phases. When the
 * knowledge subsystem is enabled, a knowledge-health phase is appended.
 *
 * @returns An array of phases to pass to {@link ReconciliationManager}.
 */
export function createReconciliationPhases(): ReconciliationPhase[] {
  const cronPhase = createCronPhase({
    getDueSchedules: scheduleStore.getDueSchedules,
    advanceSchedule: scheduleStore.advanceSchedule,
    createTask: taskStore.createTask,
    setTaskScheduleId: taskStore.setTaskScheduleId,
    startTaskSession,
    emit,
    findFirstConnectedEnvironment,
    getPersona: personaStore.getPersona,
    getTask: taskStore.getTask,
    setScheduleEnabled: scheduleStore.setScheduleEnabled,
    isEnvironmentConnected: (id: string): boolean => {
      const env = envRegistry.getEnvironment(id);
      return env?.status === "connected";
    },
  });

  const orphanPhase = createOrphanPhase({
    listAllTasks: () => {
      const workspaces = workspaceStore.listWorkspaces();
      const allTasks: Array<ReturnType<typeof taskStore.getTask> & {}> = [];
      for (const ws of workspaces) {
        allTasks.push(...taskStore.listTasks(ws.id));
      }
      return allTasks;
    },
    reparentTask: (taskId: string, newParentTaskId: string) =>
      taskStore.reparentTask(taskId, newParentTaskId),
    emit,
  });

  const phases: ReconciliationPhase[] = [cronPhase, lifecycleCleanupPhase, orphanPhase];

  if (isKnowledgeEnabled()) {
    phases.push(
      createKnowledgeHealthPhase({ healthCheck: neo4jHealthCheck }),
    );
  }

  return phases;
}
