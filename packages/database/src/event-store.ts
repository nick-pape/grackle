import { and, desc, eq, gte, lt, lte, type SQL } from "drizzle-orm";
import db from "./db.js";
import { domainEvents, type DomainEventRow } from "./schema.js";

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

/** Default number of rows returned by {@link queryDomainEvents} when no limit is given. */
const DEFAULT_DOMAIN_EVENT_LIMIT: number = 100;
/** Hard cap on rows returned by {@link queryDomainEvents}. */
const MAX_DOMAIN_EVENT_LIMIT: number = 1000;

/** Filters for {@link queryDomainEvents}. All optional; combined with AND. */
export interface DomainEventQuery {
  /** Return only events whose ULID `id` sorts before this value (exclusive) — page into older history. */
  beforeId?: string;
  /** Return only events of this exact type (e.g. "task.created"). */
  type?: string;
  /** Return only events with `timestamp >=` this ISO 8601 value (inclusive). */
  since?: string;
  /** Return only events with `timestamp <=` this ISO 8601 value (inclusive). */
  until?: string;
  /** Max rows to return (default {@link DEFAULT_DOMAIN_EVENT_LIMIT}, capped at {@link MAX_DOMAIN_EVENT_LIMIT}). */
  limit?: number;
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

/**
 * Query persisted domain events, **most recent first** (ordered by `id`
 * descending — ids are ULIDs, so id order is chronological). Filters compose
 * with AND; `beforeId` pages into older history. This is the read side of the
 * `domain_events` event store (RFC #1264 Phase 1) — see {@link persistEvent} for the write side.
 *
 * @param query - Optional `beforeId` cursor / type / time filters and limit.
 * @returns Matching rows, newest first.
 */
export function queryDomainEvents(query: DomainEventQuery = {}): DomainEventRow[] {
  const conditions: SQL[] = [];
  if (query.beforeId) {
    conditions.push(lt(domainEvents.id, query.beforeId));
  }
  if (query.type) {
    conditions.push(eq(domainEvents.type, query.type));
  }
  if (query.since) {
    conditions.push(gte(domainEvents.timestamp, query.since));
  }
  if (query.until) {
    conditions.push(lte(domainEvents.timestamp, query.until));
  }

  const limit: number = Math.min(
    query.limit && query.limit > 0 ? query.limit : DEFAULT_DOMAIN_EVENT_LIMIT,
    MAX_DOMAIN_EVENT_LIMIT,
  );

  const base = db.select().from(domainEvents);
  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered.orderBy(desc(domainEvents.id)).limit(limit).all();
}
