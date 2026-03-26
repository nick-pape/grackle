/**
 * Orphan reparenting — automatically reparent non-terminal children when
 * a parent task reaches terminal state (complete/failed).
 *
 * Follows the SIGCHLD subscriber pattern: subscribes to domain events,
 * detects orphan conditions, and reparents children to the grandparent.
 * The root task (PID 1) is the ultimate adopter.
 */

import { ROOT_TASK_ID, TASK_STATUS } from "@grackle-ai/common";
import { subscribe, emit, type GrackleEvent } from "../event-bus.js";
import { taskStore, sessionStore } from "@grackle-ai/database";
import * as streamRegistry from "../stream-registry.js";
import { ensureAsyncDeliveryListener } from "../pipe-delivery.js";
import { deliverSignalToTask } from "./signal-delivery.js";
import { logger } from "../logger.js";

/** Terminal task statuses that trigger orphan reparenting. */
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  TASK_STATUS.COMPLETE,
  TASK_STATUS.FAILED,
]);

/** How long (ms) to remember a processed parent before allowing re-processing. */
const DEDUP_TTL_MS: number = 3_600_000; // 1 hour

/** Track processed parents to prevent duplicate reparenting: parentTaskId → timestamp. */
const processed: Map<string, number> = new Map();

/** Whether the subscriber has been initialized. */
let initialized: boolean = false;

/**
 * Initialize the orphan reparenting event-bus subscriber.
 * Idempotent — safe to call multiple times.
 */
export function initOrphanReparentSubscriber(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  subscribe((event: GrackleEvent) => {
    if (event.type !== "task.completed" && event.type !== "task.updated") {
      return;
    }

    const parentTaskId = event.payload.taskId as string | undefined;
    if (!parentTaskId) {
      return;
    }

    // Root task never completes — guard defensively
    if (parentTaskId === ROOT_TASK_ID) {
      return;
    }

    // Fire-and-forget async handler — errors are logged, never thrown
    (async () => {
      try {
        await handleParentTerminal(parentTaskId);
      } catch (err) {
        logger.error({ err, parentTaskId }, "Orphan reparenting failed for parent task");
      }
    })().catch(() => { /* swallowed — logged above */ });
  });
}

/**
 * Check if a parent task is terminal and reparent its non-terminal children.
 */
async function handleParentTerminal(parentTaskId: string): Promise<void> {
  const parentTask = taskStore.getTask(parentTaskId);
  if (!parentTask) {
    return;
  }

  // Only trigger for terminal statuses
  if (!TERMINAL_TASK_STATUSES.has(parentTask.status)) {
    return;
  }

  // Deduplication: skip if we already processed this parent recently
  const now = Date.now();
  const lastProcessed = processed.get(parentTaskId);
  if (lastProcessed && now - lastProcessed < DEDUP_TTL_MS) {
    return;
  }

  // Get non-terminal children
  const orphans = taskStore.getOrphanedTasks(parentTaskId);
  if (orphans.length === 0) {
    return;
  }

  // Mark as processed before doing work (prevents concurrent re-entry)
  processed.set(parentTaskId, now);

  // Determine the grandparent (or root task as ultimate adopter)
  const grandparentId = parentTask.parentTaskId || ROOT_TASK_ID;

  logger.info(
    { parentTaskId, grandparentId, orphanCount: orphans.length, reason: parentTask.status },
    "Reparenting orphaned children to grandparent",
  );

  // Transfer ALL pipe fds from dead parent to grandparent (once, not per child)
  transferAllPipeSubscriptions(parentTaskId, grandparentId);

  // Reparent each orphan
  for (const orphan of orphans) {
    try {
      taskStore.reparentTask(orphan.id, grandparentId);

      emit("task.reparented", {
        taskId: orphan.id,
        oldParentTaskId: parentTaskId,
        newParentTaskId: grandparentId,
        workspaceId: orphan.workspaceId || "",
      });

      emit("task.updated", {
        taskId: orphan.id,
        workspaceId: orphan.workspaceId || "",
      });

      // Deliver [ADOPTED] signal to grandparent
      const message =
        `[ADOPTED] Task "${orphan.title}" (${orphan.id}) was adopted from ` +
        `terminated parent "${parentTask.title}" (${parentTask.id}). ` +
        `The task is now your direct child. Use ipc_list_fds to see transferred pipe fds.`;

      await deliverSignalToTask(grandparentId, "adopted", message);
    } catch (err) {
      logger.error(
        { err, orphanId: orphan.id, parentTaskId, grandparentId },
        "Failed to reparent orphan — continuing with remaining children",
      );
    }
  }

  // Evict stale dedup entries
  for (const [key, ts] of processed) {
    if (now - ts > DEDUP_TTL_MS) {
      processed.delete(key);
    }
  }
}

/**
 * Transfer ALL pipe subscriptions from a dead parent's sessions to the
 * grandparent's active session. Called once per parent death (not per child).
 *
 * When a parent dies, all its pipe connections should move to the grandparent —
 * like fd inheritance when a Unix process dies and init takes over.
 *
 * Exported so it can be called synchronously from completeTask() /
 * killSessionAndCleanup() before sessions are cleaned up.
 */
export function transferAllPipeSubscriptions(
  deadParentTaskId: string,
  grandparentTaskId: string,
): void {
  const grandparentSessions = sessionStore.getActiveSessionsForTask(grandparentTaskId);
  if (grandparentSessions.length === 0) {
    logger.debug(
      { deadParentTaskId, grandparentTaskId },
      "No active grandparent session — skipping pipe fd transfer",
    );
    return;
  }
  const grandparentSessionId = grandparentSessions[0].id;

  const parentSessions = sessionStore.listSessionsForTask(deadParentTaskId);
  let transferred = 0;

  for (const parentSession of parentSessions) {
    const subs = streamRegistry.getSubscriptionsForSession(parentSession.id);

    for (const sub of subs) {
      const stream = streamRegistry.getStream(sub.streamId);
      if (!stream?.name.startsWith("pipe:")) {
        continue;
      }

      try {
        streamRegistry.subscribe(
          sub.streamId,
          grandparentSessionId,
          sub.permission,
          sub.deliveryMode,
          sub.createdBySpawn,
        );
        streamRegistry.unsubscribe(sub.id);

        if (sub.deliveryMode === "async") {
          ensureAsyncDeliveryListener(grandparentSessionId);
        }

        transferred++;
      } catch (err) {
        logger.warn(
          { err, stream: stream.name, deadParentTaskId },
          "Failed to transfer pipe fd",
        );
      }
    }
  }

  if (transferred > 0) {
    logger.info(
      { deadParentTaskId, grandparentTaskId, grandparentSessionId, transferred },
      "Transferred %d pipe fd(s) to grandparent session",
      transferred,
    );
  }
}

/**
 * Reset module state. For testing only.
 * @internal
 */
export function _resetForTesting(): void {
  initialized = false;
  processed.clear();
}
