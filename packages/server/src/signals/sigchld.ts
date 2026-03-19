import { SESSION_STATUS } from "@grackle-ai/common";
import { subscribe, type GrackleEvent } from "../event-bus.js";
import * as taskStore from "../task-store.js";
import * as sessionStore from "../session-store.js";
import { readLog } from "../log-writer.js";
import { deliverSignalToTask } from "./signal-delivery.js";
import { logger } from "../logger.js";

/** Maximum length for the child's last text message in the notification. */
const MAX_LAST_MESSAGE_LENGTH: number = 2000;

/** Terminal session statuses that trigger SIGCHLD. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  SESSION_STATUS.COMPLETED,
  SESSION_STATUS.FAILED,
  SESSION_STATUS.INTERRUPTED,
]);

/** How long (ms) to remember a delivered notification before allowing re-delivery. */
const DEDUP_TTL_MS: number = 3_600_000; // 1 hour

/** Track delivered notifications to prevent duplicates: key → delivery timestamp. */
const delivered: Map<string, number> = new Map();

/** Human-readable status labels for the notification text. */
const STATUS_LABELS: Record<string, string> = {
  [SESSION_STATUS.COMPLETED]: "completed successfully",
  [SESSION_STATUS.FAILED]: "failed",
  [SESSION_STATUS.INTERRUPTED]: "was interrupted",
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
 * Handle a task.updated event: check if the task is a child with a terminal
 * session, and if so, deliver a SIGCHLD notification to the parent.
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

  // Check if the child has a terminal session
  const latestSession = sessionStore.getLatestSessionForTask(childTaskId);
  if (!latestSession) {
    return;
  }

  if (!TERMINAL_STATUSES.has(latestSession.status)) {
    return;
  }

  // Idempotency: don't re-deliver for the same child+session pair
  const dedupeKey = `${childTaskId}:${latestSession.id}`;
  const now = Date.now();
  const previousDelivery = delivered.get(dedupeKey);
  if (previousDelivery !== undefined && now - previousDelivery < DEDUP_TTL_MS) {
    return;
  }

  // Prune expired entries to prevent unbounded growth
  pruneDelivered(now);

  // Extract the last text message from the child's session log
  const lastTextMessage = extractLastTextMessage(latestSession.logPath || undefined);

  // Format the notification
  const statusLabel = STATUS_LABELS[latestSession.status] || latestSession.status;
  let message = `[SIGCHLD] Child task "${childTask.title}" (${childTaskId}) ${statusLabel}.`;

  if (lastTextMessage) {
    const truncated = lastTextMessage.length > MAX_LAST_MESSAGE_LENGTH
      ? lastTextMessage.slice(0, MAX_LAST_MESSAGE_LENGTH) + "..."
      : lastTextMessage;
    message += `\n\nLast message from child:\n> ${truncated}`;
  }

  logger.info(
    { childTaskId, parentTaskId: childTask.parentTaskId, status: latestSession.status },
    "Delivering SIGCHLD to parent task",
  );

  const success = await deliverSignalToTask(childTask.parentTaskId, "sigchld", message);

  // Only record dedup after successful delivery so failed deliveries can retry
  if (success) {
    delivered.set(dedupeKey, now);
  } else {
    logger.warn(
      { childTaskId, parentTaskId: childTask.parentTaskId },
      "SIGCHLD delivery failed — will retry on next task.updated event",
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
 * Returns an empty string if no text entries exist or the log cannot be read.
 */
function extractLastTextMessage(logPath: string | undefined): string {
  if (!logPath) {
    return "";
  }

  try {
    const entries = readLog(logPath);
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === "text") {
        return entries[i].content;
      }
    }
    return "";
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
