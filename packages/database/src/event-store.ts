import db from "./db.js";

/** A domain event to be persisted. */
export interface DomainEvent {
  /** ULID — chronologically sortable unique identifier. */
  id: string;
  /** Dot-notation event type (e.g. "task.created"). */
  type: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Domain-specific payload. */
  payload: Record<string, unknown>;
}

/** Prepared statement for inserting domain events (lazy-initialized). */
let insertStmt: ReturnType<typeof db.$client.prepare> | undefined;

/**
 * Persist a domain event to the `domain_events` SQLite table.
 * Called synchronously by `emit()` — SQLite in WAL mode handles this efficiently.
 *
 * @param event - The fully-formed domain event to persist.
 */
export function persistEvent(event: DomainEvent): void {
  if (!insertStmt) {
    insertStmt = db.$client.prepare(
      "INSERT INTO domain_events (id, type, timestamp, payload) VALUES (?, ?, ?, ?)",
    );
  }
  insertStmt.run([event.id, event.type, event.timestamp, JSON.stringify(event.payload)]);
}
