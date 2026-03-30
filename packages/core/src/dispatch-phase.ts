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
  /** Check whether an environment exists in the registry. */
  environmentExists: (environmentId: string) => boolean;
  /** Check if a task is eligible to start (deps met, no active session). */
  isTaskEligible: (taskId: string) => boolean;
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
 * 2. For each: dequeues orphans (deleted task/environment), skips if disconnected or at capacity
 * 3. Verifies task eligibility (deps met, not already working) before spawning
 * 4. Calls startTaskSession; on success dequeues, on failure keeps queued for retry
 * 5. Each entry is wrapped in try/catch so one bad task doesn't block others
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
        try {
          await dispatchEntry(deps, entry);
        } catch (err) {
          // Catch unexpected throws so one bad entry doesn't abort the entire tick.
          // Entry stays queued for retry on next tick.
          logger.error(
            { taskId: entry.taskId, environmentId: entry.environmentId, err },
            "Dispatch: unexpected error processing entry",
          );
        }
      }
    },
  };
}

/** Process a single dispatch queue entry. */
async function dispatchEntry(deps: DispatchPhaseDeps, entry: DispatchQueueRow): Promise<void> {
  // Dequeue entries whose environment has been removed entirely (not just disconnected)
  if (!deps.environmentExists(entry.environmentId)) {
    deps.dequeueEntry(entry.taskId);
    logger.debug({ taskId: entry.taskId, environmentId: entry.environmentId }, "Dispatch: dequeued orphan (environment removed)");
    return;
  }

  // Skip if environment is disconnected (may reconnect later)
  if (!deps.isEnvironmentConnected(entry.environmentId)) {
    return;
  }

  // Skip if environment is at capacity
  if (!deps.hasCapacity(entry.environmentId)) {
    return;
  }

  // Look up the task (may have been deleted since enqueue)
  const task = deps.getTask(entry.taskId);
  if (!task) {
    deps.dequeueEntry(entry.taskId);
    logger.debug({ taskId: entry.taskId }, "Dispatch: dequeued stale entry (task deleted)");
    return;
  }

  // Verify the task is still eligible (deps met, not already working from a concurrent start).
  // Skip rather than dequeue — eligibility may change (e.g. deps become met on a later tick).
  if (!deps.isTaskEligible(entry.taskId)) {
    return;
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
