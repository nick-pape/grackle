import { ulid } from "ulid";
import { SequencedLog } from "@grackle-ai/common";
import { DomainEventSink, DOMAIN_EVENT_CHANNEL, type DomainEventInput } from "@grackle-ai/database";
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
  | "finding.posted"
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
  | "github_account.changed";

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

// ─── Module State ─────────────────────────────────────────

const subscribers: Set<Subscriber> = new Set();

/**
 * Durable, monotonically-sequenced log backing all domain events (RFC #1264).
 * The log assigns each event a ULID sequence key (which becomes the event id)
 * and persists it via the SQLite-backed {@link DomainEventSink}.
 */
const domainEventLog: SequencedLog<DomainEventInput> = new SequencedLog<DomainEventInput>({
  sink: new DomainEventSink(),
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
export function emit(
  type: GrackleEventType,
  payload: Record<string, unknown>,
): GrackleEvent {
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
