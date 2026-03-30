/**
 * Dispatch reconciliation phase — drains the dispatch queue on each tick.
 *
 * Picks up tasks that were enqueued (because the target environment was at
 * concurrency capacity) and spawns them when capacity frees up. Follows the
 * same dependency-injection pattern as cron-phase.ts for testability.
 */

import { logger } from "./logger.js";
import type { DispatchQueueRow, TaskRow } from "@grackle-ai/database";
import type { ReconciliationPhase } from "./reconciliation-manager.js";

/** Dependencies injected into the dispatch phase for testability. */
export interface DispatchPhaseDeps {
  /** List all pending dispatch queue entries in FIFO order. */
  listPendingEntries: () => DispatchQueueRow[];
  /** Remove an entry from the dispatch queue by taskId. */
  dequeueEntry: (taskId: string) => void;
  /** Look up a task by ID. */
  getTask: (taskId: string) => TaskRow | undefined;
  /** Check whether an environment has capacity for another session. */
  hasCapacity: (environmentId: string) => boolean;
  /** Start a task session. Returns error string on failure, undefined on success. */
  startTaskSession: (
    task: TaskRow,
    options?: { personaId?: string; environmentId?: string; notes?: string },
  ) => Promise<string | undefined>;
  /** Check if an environment is connected. */
  isEnvironmentConnected: (environmentId: string) => boolean;
}

/**
 * Create a ReconciliationPhase that drains the dispatch queue.
 *
 * On each tick:
 * 1. Lists pending entries in FIFO order
 * 2. For each: skips if env disconnected or at capacity, removes stale entries
 * 3. Calls startTaskSession to spawn a session when possible
 * 4. On successful start, dequeues the entry (startTaskSession emits task.started)
 */
export function createDispatchPhase(deps: DispatchPhaseDeps): ReconciliationPhase {
  return {
    name: "dispatch",
    execute: async () => {
      const pending = deps.listPendingEntries();
      if (pending.length === 0) {
        return;
      }

      logger.debug({ count: pending.length }, "Dispatch phase: pending entries");

      for (const entry of pending) {
        // Skip if environment is disconnected
        if (!deps.isEnvironmentConnected(entry.environmentId)) {
          continue;
        }

        // Skip if environment is at capacity
        if (!deps.hasCapacity(entry.environmentId)) {
          continue;
        }

        // Look up the task (may have been deleted since enqueue)
        const task = deps.getTask(entry.taskId);
        if (!task) {
          deps.dequeueEntry(entry.taskId);
          logger.debug({ taskId: entry.taskId }, "Dispatch: dequeued stale entry (task deleted)");
          continue;
        }

        const error = await deps.startTaskSession(task, {
          environmentId: entry.environmentId,
          personaId: entry.personaId,
          notes: entry.notes,
        });

        if (error) {
          logger.warn(
            { taskId: entry.taskId, environmentId: entry.environmentId, error },
            "Dispatch: session start failed — entry stays queued for retry",
          );
        } else {
          // Dequeue only after successful start to avoid losing tasks on transient failures.
          // startTaskSession already emits "task.started" so we don't emit it here.
          deps.dequeueEntry(entry.taskId);
          logger.info(
            { taskId: entry.taskId, environmentId: entry.environmentId },
            "Dispatch: task started",
          );
        }
      }
    },
  };
}
