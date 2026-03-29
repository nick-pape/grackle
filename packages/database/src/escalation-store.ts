import db from "./db.js";
import { escalations, type EscalationRow } from "./schema.js";
import { eq, desc, asc, and } from "drizzle-orm";

export type { EscalationRow };

/** Insert a new escalation record. Status defaults to "pending". */
export function createEscalation(
  id: string,
  workspaceId: string,
  taskId: string,
  title: string,
  message: string,
  source: string,
  urgency: string,
  taskUrl: string,
): void {
  db.insert(escalations).values({
    id,
    workspaceId,
    taskId,
    title,
    message,
    source,
    urgency,
    taskUrl,
  }).run();
}

/** Retrieve a single escalation by ID. */
export function getEscalation(id: string): EscalationRow | undefined {
  return db.select().from(escalations)
    .where(eq(escalations.id, id))
    .get();
}

/**
 * List escalations, optionally filtering by workspace and status.
 * Returns results ordered by createdAt descending (most recent first).
 */
export function listEscalations(
  workspaceId?: string,
  status?: string,
  limit?: number,
): EscalationRow[] {
  const maxResults = Math.min(limit || 50, 100);

  const hasWorkspaceFilter = workspaceId !== undefined && workspaceId.length > 0;
  const hasStatusFilter = status !== undefined && status.length > 0;

  if (hasWorkspaceFilter && hasStatusFilter) {
    return db.select().from(escalations)
      .where(and(
        eq(escalations.workspaceId, workspaceId),
        eq(escalations.status, status),
      ))
      .orderBy(desc(escalations.createdAt))
      .limit(maxResults)
      .all();
  } else if (hasWorkspaceFilter) {
    return db.select().from(escalations)
      .where(eq(escalations.workspaceId, workspaceId))
      .orderBy(desc(escalations.createdAt))
      .limit(maxResults)
      .all();
  } else if (hasStatusFilter) {
    return db.select().from(escalations)
      .where(eq(escalations.status, status))
      .orderBy(desc(escalations.createdAt))
      .limit(maxResults)
      .all();
  } else {
    return db.select().from(escalations)
      .orderBy(desc(escalations.createdAt))
      .limit(maxResults)
      .all();
  }
}

/**
 * List all pending escalations ordered by createdAt ascending (oldest first).
 * Used by the notification router to drain the outbox in order.
 */
export function listPendingEscalations(): EscalationRow[] {
  return db.select().from(escalations)
    .where(eq(escalations.status, "pending"))
    .orderBy(asc(escalations.createdAt))
    .all();
}

/**
 * Update an escalation's status. Sets the appropriate timestamp
 * (deliveredAt for "delivered", acknowledgedAt for "acknowledged").
 */
export function updateEscalationStatus(id: string, status: string): void {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status };

  if (status === "delivered") {
    updates.deliveredAt = now;
  } else if (status === "acknowledged") {
    updates.acknowledgedAt = now;
  }

  db.update(escalations)
    .set(updates as { status: string; deliveredAt?: string; acknowledgedAt?: string })
    .where(eq(escalations.id, id))
    .run();
}
