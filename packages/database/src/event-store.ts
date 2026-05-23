import db from "./db.js";
import type { LogSink, Sequenced } from "@grackle-ai/common";

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

/**
 * A domain event prior to sequencing — the payload appended to the domain-event
 * {@link DomainEventSink}. The `id` is assigned by the {@link SequencedLog} as
 * the sequence key, so it is not part of the input.
 */
export interface DomainEventInput {
  /** Dot-notation event type (e.g. "task.created"). */
  type: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Domain-specific payload. */
  payload: Record<string, unknown>;
}

/** Channel id for the single global domain-event log. */
export const DOMAIN_EVENT_CHANNEL: string = "domain";

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

/**
 * {@link LogSink} that persists domain events to the `domain_events` SQLite
 * table, using the log-assigned sequence key as the row id. Sequencing / key
 * generation lives in the {@link SequencedLog} writer; this sink only stores.
 * (RFC #1264 Phase 0.)
 */
export class DomainEventSink implements LogSink<DomainEventInput> {
  /**
   * Persist a sequenced domain event; the entry's `seq` becomes the row id.
   *
   * @param channelId - Must be {@link DOMAIN_EVENT_CHANNEL}.
   * @param entry - The sequenced domain-event input.
   */
  public append(channelId: string, entry: Sequenced<DomainEventInput>): void {
    if (channelId !== DOMAIN_EVENT_CHANNEL) {
      throw new Error(`DomainEventSink received unexpected channel "${channelId}"`);
    }
    persistEvent({
      id: entry.seq,
      type: entry.payload.type,
      timestamp: entry.payload.timestamp,
      payload: entry.payload.payload,
    });
  }
}
