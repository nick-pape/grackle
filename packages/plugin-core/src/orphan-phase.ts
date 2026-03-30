/**
 * Orphan reconciliation phase — periodic safety net for orphaned tasks.
 *
 * Sweeps all tasks for children whose parent is in a terminal state but
 * haven't been reparented by the event-driven handler. This catches edge
 * cases like server restarts, race conditions, or missed events.
 */

import { ROOT_TASK_ID, TASK_STATUS } from "@grackle-ai/common";
import { logger } from "@grackle-ai/core";
import type { TaskRow } from "@grackle-ai/database";
import type { GrackleEventType } from "@grackle-ai/core";
import type { ReconciliationPhase } from "@grackle-ai/core";

/** Terminal task statuses that indicate the parent is done. */
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  TASK_STATUS.COMPLETE,
  TASK_STATUS.FAILED,
]);

/** Dependencies injected into the orphan phase for testability. */
export interface OrphanPhaseDeps {
  /** Get all tasks (across all workspaces). */
  listAllTasks: () => TaskRow[];
  /** Reparent a task to a new parent. */
  reparentTask: (taskId: string, newParentTaskId: string) => void;
  /** Emit a domain event. */
  emit: (type: GrackleEventType, payload: Record<string, unknown>) => void;
}

/**
 * Create the orphan reconciliation phase.
 *
 * @param deps - Injected dependencies for testability.
 * @returns A ReconciliationPhase that can be registered with the ReconciliationManager.
 */
export function createOrphanPhase(deps: OrphanPhaseDeps): ReconciliationPhase {
  return {
    name: "orphan-reparent",
    execute: async () => {
      const allTasks = deps.listAllTasks();

      // Build a lookup map for quick parent resolution
      const taskById = new Map<string, TaskRow>(allTasks.map((t) => [t.id, t]));

      let reparentCount = 0;

      for (const task of allTasks) {
        // Skip root tasks and tasks with no parent
        if (!task.parentTaskId || task.parentTaskId === ROOT_TASK_ID) {
          continue;
        }

        // Skip terminal tasks (they don't need reparenting)
        if (TERMINAL_TASK_STATUSES.has(task.status)) {
          continue;
        }

        // Check if parent is terminal
        const parent = taskById.get(task.parentTaskId);
        if (!parent || !TERMINAL_TASK_STATUSES.has(parent.status)) {
          continue;
        }

        // This is an orphan! Reparent to grandparent (or root)
        const grandparentId = parent.parentTaskId || ROOT_TASK_ID;

        try {
          deps.reparentTask(task.id, grandparentId);
          deps.emit("task.reparented", {
            taskId: task.id,
            oldParentTaskId: task.parentTaskId,
            newParentTaskId: grandparentId,
            workspaceId: task.workspaceId || "",
          });
          deps.emit("task.updated", {
            taskId: task.id,
            workspaceId: task.workspaceId || "",
          });
          reparentCount++;
        } catch (err) {
          logger.error(
            { err, taskId: task.id, parentTaskId: task.parentTaskId, grandparentId },
            "Orphan phase: failed to reparent task",
          );
        }
      }

      if (reparentCount > 0) {
        logger.warn(
          { reparentCount },
          "Orphan phase: reparented %d orphaned task(s) — these should have been caught by the event-driven handler",
          reparentCount,
        );
      }
    },
  };
}
