import { ulid } from "ulid";
import { persistEvent } from "./event-store.js";
import { logger } from "./logger.js";

// ─── Event Types ──────────────────────────────────────────

/** All domain event types emitted by the event bus. */
export type GrackleEventType =
  | "task.created"
  | "task.updated"
  | "task.started"
  | "task.completed"
  | "task.deleted"
  | "project.created"
  | "project.archived"
  | "project.updated"
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
  | "setting.changed";

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
  const event: GrackleEvent = {
    id: ulid(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  };

  // Persist synchronously (SQLite is fast in WAL mode)
  try {
    persistEvent(event);
  } catch (err) {
    logger.error({ err, event }, "Failed to persist domain event");
  }

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
