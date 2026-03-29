/**
 * Notification router — delivers escalations to all available channels.
 *
 * Channels:
 * 1. Domain event broadcast (always) — reaches connected web UI clients via StreamEvents.
 * 2. Webhook POST (when configured) — sends JSON to a user-provided URL.
 *
 * Persist-first, route-second: escalations are SQLite rows before this runs.
 */

import { escalationStore, settingsStore, type EscalationRow } from "@grackle-ai/database";
import { emit } from "./event-bus.js";
import { logger } from "./logger.js";

/** Webhook request timeout in milliseconds. */
const WEBHOOK_TIMEOUT_MS: number = 10_000;

/** Guard to prevent concurrent drain operations. */
let drainInFlight: boolean = false;

/**
 * Route an escalation to all available notification channels.
 * Always emits a domain event (for browser notifications). Optionally
 * POSTs to a webhook if configured. Updates escalation status to "delivered".
 */
export async function routeEscalation(escalation: EscalationRow): Promise<void> {
  // Channel 1: Domain event broadcast (always fires — reaches connected web UIs)
  emit("notification.escalated", {
    escalationId: escalation.id,
    workspaceId: escalation.workspaceId,
    taskId: escalation.taskId,
    title: escalation.title,
    message: escalation.message,
    source: escalation.source,
    urgency: escalation.urgency,
    taskUrl: escalation.taskUrl,
  });

  // Channel 2: Webhook POST (optional)
  const webhookUrl = settingsStore.getSetting("webhook_url");
  if (webhookUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, WEBHOOK_TIMEOUT_MS);
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            type: "awaiting_input",
            timestamp: escalation.createdAt,
            escalationId: escalation.id,
            workspaceId: escalation.workspaceId,
            task: {
              taskId: escalation.taskId,
              title: escalation.title,
              message: escalation.message,
              urgency: escalation.urgency,
              url: escalation.taskUrl,
            },
          }),
        });
        if (!response.ok) {
          logger.warn(
            { escalationId: escalation.id, webhookUrl, status: response.status },
            "Webhook returned non-OK status",
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      logger.error({ err, escalationId: escalation.id, webhookUrl }, "Webhook delivery failed");
    }
  }

  // Mark as delivered (domain event always fires, so at least one channel succeeded)
  escalationStore.updateEscalationStatus(escalation.id, "delivered");
}

/**
 * Drain the escalation outbox — deliver all pending escalations.
 * Called on web UI reconnect to catch up on missed notifications.
 * Guarded against concurrent invocations to prevent duplicate delivery.
 */
export async function deliverPendingEscalations(): Promise<void> {
  if (drainInFlight) {
    return;
  }
  drainInFlight = true;
  try {
    const pending = escalationStore.listPendingEscalations();
    for (const escalation of pending) {
      await routeEscalation(escalation);
    }
  } finally {
    drainInFlight = false;
  }
}
