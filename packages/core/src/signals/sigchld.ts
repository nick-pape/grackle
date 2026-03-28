import { SESSION_STATUS } from "@grackle-ai/common";
import { subscribe, type GrackleEvent } from "../event-bus.js";
import { taskStore, sessionStore } from "@grackle-ai/database";
import { readLastTextEntry } from "../log-writer.js";
import { deliverSignalToTask } from "./signal-delivery.js";
import { logger } from "../logger.js";

/** Maximum length for the child's last text message in the notification. */
const MAX_LAST_MESSAGE_LENGTH: number = 2000;

/** Maximum number of delivery attempts (1 initial + retries). */
const MAX_DELIVERY_ATTEMPTS: number = 3;

/** Delay (ms) between delivery retries. */
const DELIVERY_RETRY_DELAY_MS: number = 1_000;

/**
 * Session statuses that trigger SIGCHLD. LLM agents don't reliably exit() —
 * they go IDLE when they stop working. STOPPED fires when the session's event
 * stream ends (agent-initiated, not user-initiated — the user marking a task
 * "Complete" emits task.completed which this subscriber does not listen to).
 * Dedup prevents double notification if both IDLE and STOPPED fire for the
 * same session.
 */
const SIGCHLD_STATUSES: ReadonlySet<string> = new Set([
  SESSION_STATUS.IDLE,
  SESSION_STATUS.STOPPED,
]);

/** How long (ms) to remember a delivered notification before allowing re-delivery. */
const DEDUP_TTL_MS: number = 3_600_000; // 1 hour

/** Track delivered notifications to prevent duplicates: key → delivery timestamp. */
const delivered: Map<string, number> = new Map();

/** Human-readable status labels for the notification text (non-STOPPED statuses only). */
const STATUS_LABELS: Record<string, string> = {
  [SESSION_STATUS.IDLE]: "finished working (awaiting review)",
};

/**
 * Initialize the SIGCHLD event-bus subscriber.
 * Idempotent — safe to call multiple times.
 */
let initialized: boolean = false;

export function initSigchldSubscriber(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  subscribe((event: GrackleEvent) => {
    if (event.type !== "task.updated") {
      return;
    }

    const childTaskId = event.payload.taskId as string | undefined;
    if (!childTaskId) {
      return;
    }

    // Fire-and-forget async handler — errors are logged, never thrown
    (async () => {
      try {
        await handleTaskUpdated(childTaskId);
      } catch (err) {
        logger.error({ err, childTaskId }, "SIGCHLD handler error");
      }
    })().catch(() => { /* swallowed — logged above */ });
  });

  logger.info("SIGCHLD subscriber initialized");
}

/**
 * Handle a task.updated event: check if the task is a child whose latest
 * session has reached a SIGCHLD-triggering status (idle or terminal),
 * and if so, deliver a SIGCHLD notification to the parent.
 */
async function handleTaskUpdated(childTaskId: string): Promise<void> {
  const childTask = taskStore.getTask(childTaskId);
  if (!childTask) {
    return;
  }

  // Only child tasks (with a parent) trigger SIGCHLD
  if (!childTask.parentTaskId) {
    return;
  }

  // Check if the child session is in a SIGCHLD-triggering status (idle or terminal)
  const latestSession = sessionStore.getLatestSessionForTask(childTaskId);
  if (!latestSession) {
    return;
  }

  if (!SIGCHLD_STATUSES.has(latestSession.status)) {
    return;
  }

  // Idempotency: don't re-deliver for the same child+session pair.
  // Set the key optimistically to prevent concurrent async handlers from
  // both passing the check (e.g. completed + interrupted firing together).
  const dedupeKey = `${childTaskId}:${latestSession.id}`;
  const now = Date.now();
  const previousDelivery = delivered.get(dedupeKey);
  if (previousDelivery !== undefined && now - previousDelivery < DEDUP_TTL_MS) {
    return;
  }
  delivered.set(dedupeKey, now);

  // Prune expired entries to prevent unbounded growth
  pruneDelivered(now);

  // Extract the last text message from the child's session log
  const lastTextMessage = extractLastTextMessage(latestSession.logPath || undefined);

  // Format the notification with actionable instructions for the parent
  let statusLabel: string;
  if (latestSession.status === SESSION_STATUS.STOPPED) {
    statusLabel = latestSession.endReason === "completed"
      ? "completed successfully"
      : latestSession.endReason === "killed"
        ? "was killed"
        : "crashed unexpectedly";
  } else {
    statusLabel = STATUS_LABELS[latestSession.status] || latestSession.status;
  }
  let message = `[SIGCHLD] Child task "${childTask.title}" (${childTaskId}) ${statusLabel}.`;

  if (lastTextMessage) {
    const truncated = lastTextMessage.length > MAX_LAST_MESSAGE_LENGTH
      ? lastTextMessage.slice(0, MAX_LAST_MESSAGE_LENGTH) + "..."
      : lastTextMessage;
    message += `\n\nLast message from child:\n> ${truncated}`;
  }

  if (latestSession.status === SESSION_STATUS.IDLE) {
    message += "\n\nReview the child's work. If satisfactory, mark it complete with "
      + `task_complete({ taskId: "${childTaskId}" }). `
      + "If more work is needed, send additional input to the child's session.";
  } else if (latestSession.status === SESSION_STATUS.STOPPED && latestSession.endReason === "interrupted") {
    message += "\n\nThe child task crashed unexpectedly. Review the error and decide whether to retry or reassign the work.";
  }

  logger.info(
    { childTaskId, parentTaskId: childTask.parentTaskId, status: latestSession.status },
    "Delivering SIGCHLD to parent task",
  );

  // Retry inline on failure to prevent signal loss from the dedup race condition:
  // without retry, a concurrent handler that was deduped cannot re-attempt delivery,
  // and deleting the key only helps if another task.updated event arrives (not guaranteed).
  let success = false;
  for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      logger.warn(
        { childTaskId, parentTaskId: childTask.parentTaskId, attempt },
        "SIGCHLD delivery failed — retrying",
      );
      await new Promise<void>((resolve) => setTimeout(resolve, DELIVERY_RETRY_DELAY_MS));
    }
    success = await deliverSignalToTask(childTask.parentTaskId, "sigchld", message);
    if (success) {
      break;
    }
  }

  if (!success) {
    // All retries exhausted — delete the dedup key so future events can try again
    delivered.delete(dedupeKey);
    logger.error(
      { childTaskId, parentTaskId: childTask.parentTaskId, attempts: MAX_DELIVERY_ATTEMPTS },
      "SIGCHLD delivery failed after all retries",
    );
  }
}

/** Remove dedup entries older than DEDUP_TTL_MS. */
function pruneDelivered(now: number): void {
  for (const [key, timestamp] of delivered) {
    if (now - timestamp >= DEDUP_TTL_MS) {
      delivered.delete(key);
    }
  }
}

/**
 * Read the session log and extract the content of the last "text" entry.
 * Uses readLastTextEntry which only reads the tail of the file (up to 64 KB)
 * instead of parsing the entire log into memory.
 * Returns an empty string if no text entries exist or the log cannot be read.
 */
function extractLastTextMessage(logPath: string | undefined): string {
  if (!logPath) {
    return "";
  }

  try {
    return readLastTextEntry(logPath)?.content ?? "";
  } catch {
    return "";
  }
}

/**
 * Reset module state. For use in tests only.
 * @internal
 */
export function _resetForTesting(): void {
  delivered.clear();
  initialized = false;
}
