/**
 * Auto-detection subscriber for human escalation.
 *
 * Watches for standalone (parentless, non-system-root) tasks that go IDLE
 * and automatically creates an escalation on the agent's behalf.
 * This is the safety net for simple topologies where there is no orchestrator
 * to explicitly call `escalate_to_human`.
 */

import { SESSION_STATUS, ROOT_TASK_ID } from "@grackle-ai/common";
import type { GrackleEvent } from "@grackle-ai/core";
import { taskStore, sessionStore, escalationStore } from "@grackle-ai/database";
import { readLastTextEntry } from "@grackle-ai/core";
import { routeEscalation } from "../notification-router.js";
import { logger } from "@grackle-ai/core";
import { ulid } from "ulid";
import type { Disposable, PluginContext } from "@grackle-ai/core";

/** How long (ms) to remember a delivered notification before allowing re-delivery. */
const DEDUP_TTL_MS: number = 3_600_000; // 1 hour

/**
 * Create the auto-escalation event-bus subscriber.
 *
 * Watches for standalone (parentless, non-ROOT) tasks whose latest session
 * goes IDLE and automatically creates an escalation.
 *
 * @param ctx - Plugin context providing event-bus access.
 * @returns A Disposable that unsubscribes and clears dedup state.
 */
export function createEscalationAutoSubscriber(ctx: PluginContext): Disposable {
  /** Track delivered notifications to prevent duplicates: key -> delivery timestamp. */
  const delivered: Map<string, number> = new Map();

  const unsubscribe = ctx.subscribe((event: GrackleEvent) => {
    if (event.type !== "task.updated") {
      return;
    }

    const taskId = event.payload.taskId as string | undefined;
    if (!taskId) {
      return;
    }

    // Fire-and-forget async handler — errors are logged, never thrown
    (async () => {
      try {
        await handleTaskUpdated(delivered, taskId);
      } catch (err) {
        logger.error({ err, taskId }, "Escalation auto-detect handler error");
      }
    })().catch(() => { /* swallowed — logged above */ });
  });

  logger.info("Escalation auto-detect subscriber initialized");

  return {
    dispose(): void {
      unsubscribe();
      delivered.clear();
    },
  };
}

/**
 * Handle a task.updated event: check if the task is a standalone root task
 * whose latest session has gone IDLE, and if so, auto-escalate.
 */
async function handleTaskUpdated(delivered: Map<string, number>, taskId: string): Promise<void> {
  const task = taskStore.getTask(taskId);
  if (!task) {
    return;
  }

  // Only parentless tasks trigger auto-escalation (child tasks use SIGCHLD)
  if (task.parentTaskId) {
    return;
  }

  // Exclude the system root task — it is always idle when nobody is chatting
  if (taskId === ROOT_TASK_ID) {
    return;
  }

  // Check if the latest session is IDLE
  const latestSession = sessionStore.getLatestSessionForTask(taskId);
  if (!latestSession) {
    return;
  }

  if (latestSession.status !== SESSION_STATUS.IDLE) {
    return;
  }

  // Idempotency: don't re-deliver for the same task+session pair
  const dedupeKey = `${taskId}:${latestSession.id}`;
  const now = Date.now();
  const previousDelivery = delivered.get(dedupeKey);
  if (previousDelivery !== undefined && now - previousDelivery < DEDUP_TTL_MS) {
    return;
  }

  // Prune expired entries to prevent unbounded growth
  pruneDelivered(delivered, now);

  // Extract the last text message from the session log
  const logPath = latestSession.logPath || undefined;
  const lastEntry = logPath ? readLastTextEntry(logPath) : undefined;
  const message = lastEntry?.content ?? "";

  // Build task URL
  const taskUrl = `/tasks/${taskId}`;

  // Create and route the escalation
  const escalationId = ulid();
  const workspaceId = task.workspaceId ?? "";
  escalationStore.createEscalation(
    escalationId,
    workspaceId,
    taskId,
    task.title,
    message,
    "auto",
    "normal",
    taskUrl,
  );

  // Mark dedupe AFTER successful persistence so failures can retry
  delivered.set(dedupeKey, now);

  // Route immediately — build the row inline to avoid a round-trip read
  await routeEscalation({
    id: escalationId,
    workspaceId,
    taskId,
    title: task.title,
    message,
    source: "auto",
    urgency: "normal",
    status: "pending",
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    acknowledgedAt: null,
    taskUrl,
  });

  logger.info(
    { taskId, escalationId, title: task.title },
    "Auto-escalation created for idle standalone task",
  );
}

/** Remove dedup entries older than DEDUP_TTL_MS. */
function pruneDelivered(delivered: Map<string, number>, now: number): void {
  for (const [key, timestamp] of delivered) {
    if (now - timestamp >= DEDUP_TTL_MS) {
      delivered.delete(key);
    }
  }
}
