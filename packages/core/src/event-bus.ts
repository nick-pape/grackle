import { ulid } from "ulid";
import { SequencedLog, type LogSink } from "@grackle-ai/common";
import { persistEvent } from "@grackle-ai/database";
import { logger } from "./logger.js";

// ─── Event Types ──────────────────────────────────────────

/** All domain event types emitted by the event bus. */
export type GrackleEventType =
  | "task.created"
  | "task.updated"
  | "task.started"
  | "task.completed"
  | "task.deleted"
  | "task.reparented"
  | "workspace.created"
  | "workspace.archived"
  | "workspace.updated"
  | "persona.created"
  | "persona.updated"
  | "persona.deleted"
  | "environment.added"
  | "environment.removed"
  | "environment.changed"
  | "environment.provision_progress"
  | "token.changed"
  | "credential.providers_changed"
  | "setting.changed"
  | "schedule.created"
  | "schedule.updated"
  | "schedule.deleted"
  | "schedule.fired"
  | "notification.escalated"
  | "plugin.changed"
  | "github_account.changed"
  // A workspace's promoted-component set changed (promote/demote, or a promoted
  // component edited) — the MCP server pushes tools/list_changed to that
  // workspace's sessions so dynamic render_<name> tools refresh (#1297). payload: { workspaceId }
  | "component.changed"
  // A watched resource (file/dir) changed on an environment's PowerLine-owned
  // worktree (#1395). Forwarded from the AHP resource-watch channel; the web
  // `useResources` hook re-reads the affected URIs. payload:
  // { environmentId, uri, changes: [{ uri, type }] }
  | "resource.changed";

/** A domain event emitted by the event bus. */
export interface GrackleEvent {
  /** ULID — chronologically sortable unique identifier. */
  id: string;
  /** Dot-notation event type (e.g. "task.created"). */
  type: GrackleEventType;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Domain-specific payload. */
  payload: Record<string, unknown>;
}

/** Callback signature for event subscribers. */
export type Subscriber = (event: GrackleEvent) => void;

/**
 * Body of a domain event appended to the log. The `id` is omitted because the
 * {@link SequencedLog} assigns it as the monotonic sequence key.
 */
interface DomainEventBody {
  type: GrackleEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ─── Module State ─────────────────────────────────────────

const subscribers: Set<Subscriber> = new Set();

/** Channel id for the single global domain-event log. */
const DOMAIN_EVENT_CHANNEL: string = "domain";

/**
 * Storage sink for the domain-event log: persists each entry to the SQLite
 * `domain_events` table via {@link persistEvent}, using the log-assigned
 * sequence key as the row id. (Kept inline next to the writer so `@grackle-ai/core`
 * depends only on `persistEvent`; the database-side sink + reader arrive in
 * RFC #1264 Phase 1.)
 */
const domainEventSink: LogSink<DomainEventBody> = {
  append: (channelId, entry) => {
    if (channelId !== DOMAIN_EVENT_CHANNEL) {
      throw new Error(`domainEventSink received unexpected channel "${channelId}"`);
    }
    persistEvent({
      id: entry.seq,
      type: entry.payload.type,
      timestamp: entry.payload.timestamp,
      payload: entry.payload.payload,
    });
  },
};

/**
 * Durable, monotonically-sequenced log backing all domain events (RFC #1264).
 * The log assigns each event a ULID sequence key (which becomes the event id)
 * and persists it via {@link domainEventSink}.
 */
const domainEventLog: SequencedLog<DomainEventBody> = new SequencedLog<DomainEventBody>({
  sink: domainEventSink,
  channelId: DOMAIN_EVENT_CHANNEL,
  nextSeq: ulid,
});

// ─── Public API ───────────────────────────────────────────

/**
 * Emit a domain event. Persists to SQLite synchronously, then
 * fans out to all subscribers asynchronously via queueMicrotask.
 *
 * @param type - The dot-notation event type.
 * @param payload - Domain-specific data.
 * @returns The created GrackleEvent.
 */
export function emit(type: GrackleEventType, payload: Record<string, unknown>): GrackleEvent {
  const timestamp: string = new Date().toISOString();

  // Persist synchronously via the sequenced log (SQLite is fast in WAL mode).
  // The log assigns the monotonic ULID sequence key, which becomes the event id.
  // Intentionally non-fatal: a persistence failure is logged but does not
  // prevent subscribers from receiving the event. Domain events drive live
  // UI updates which must not break if SQLite is temporarily unavailable.
  let id: string;
  try {
    id = domainEventLog.append({ type, timestamp, payload }).seq;
  } catch (err) {
    logger.error({ err, type }, "Failed to persist domain event");
    id = ulid();
  }

  const event: GrackleEvent = { id, type, timestamp, payload };

  // Fan out asynchronously — subscriber errors never block the emitter
  queueMicrotask(() => {
    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch (err) {
        logger.error({ err, eventType: event.type }, "Subscriber error");
      }
    }
  });

  return event;
}

/**
 * Register a subscriber to receive all domain events.
 *
 * @param subscriber - Callback invoked for each emitted event.
 * @returns An unsubscribe function.
 */
export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

/**
 * Reset all subscribers. For use in tests only.
 * @internal
 */
export function _resetForTesting(): void {
  subscribers.clear();
}
