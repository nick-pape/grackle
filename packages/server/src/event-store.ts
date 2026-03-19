import db from "./db.js";
import type { GrackleEvent } from "./event-bus.js";

/** Prepared statement for inserting domain events (lazy-initialized). */
let insertStmt: ReturnType<typeof db.$client.prepare> | undefined;

/**
 * Persist a domain event to the `domain_events` SQLite table.
 * Called synchronously by `emit()` — SQLite in WAL mode handles this efficiently.
 *
 * @param event - The fully-formed GrackleEvent to persist.
 */
export function persistEvent(event: GrackleEvent): void {
  if (!insertStmt) {
    insertStmt = db.$client.prepare(
      "INSERT INTO domain_events (id, type, timestamp, payload) VALUES (?, ?, ?, ?)",
    );
  }
  insertStmt.run([event.id, event.type, event.timestamp, JSON.stringify(event.payload)]);
}
