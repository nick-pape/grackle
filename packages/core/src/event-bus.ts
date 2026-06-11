import { ulid } from "ulid";
import { SequencedLog, type LogSink, serverTimestamp } from "@grackle-ai/common";
import { getDatabaseStores } from "@grackle-ai/database";
import type { GrackleEvent, GrackleEventType } from "@grackle-ai/plugin-sdk";
import { logger } from "./logger.js";

// ─── Event Types ──────────────────────────────────────────
// `GrackleEventType` and `GrackleEvent` are defined in `@grackle-ai/plugin-sdk`
// (single source of truth). They are re-exported here so existing
// `import { GrackleEvent } from "@grackle-ai/core"` statements continue to work.

export type { GrackleEvent, GrackleEventType } from "@grackle-ai/plugin-sdk";

/**
 * Callback signature for event subscribers. May be sync or async; async rejections
 * are caught and logged by the event bus — subscribers do not need to manage their
 * own fire-and-forget error handling.
 */
export type Subscriber = (event: GrackleEvent) => void | Promise<void>;

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
 * `domain_events` table via the event store, using the log-assigned
 * sequence key as the row id. (Kept inline next to the writer so `@grackle-ai/core`
 * depends only on the event store; the database-side sink + reader arrive in
 * RFC #1264 Phase 1.)
 */
const domainEventSink: LogSink<DomainEventBody> = {
  append: (channelId, entry) => {
    if (channelId !== DOMAIN_EVENT_CHANNEL) {
      throw new Error(`domainEventSink received unexpected channel "${channelId}"`);
    }
    getDatabaseStores().eventStore.persistEvent({
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
 * Emit a domain event. Persists to SQLite synchronously, then fans out to all
 * subscribers asynchronously via queueMicrotask. Subscribers may be sync or async;
 * any rejection is logged and does not propagate to the caller or block other
 * subscribers.
 *
 * @param type - The dot-notation event type.
 * @param payload - Domain-specific data.
 * @returns The created GrackleEvent.
 */
export function emit(type: GrackleEventType, payload: Record<string, unknown>): GrackleEvent {
  const timestamp: string = serverTimestamp();

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

  // Fan out asynchronously — subscriber errors (sync or async) are caught and
  // logged, but never propagate to the emitter or block other subscribers.
  // The .catch() at the end ensures no unhandled-rejection warning from async subscribers.
  queueMicrotask(() => {
    for (const subscriber of subscribers) {
      Promise.resolve()
        .then(() => subscriber(event))
        .catch((err: unknown) => {
          logger.error({ err, eventType: event.type }, "Subscriber error");
        });
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
