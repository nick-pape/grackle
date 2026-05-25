/**
 * In-process pub/sub for live IPC stream messages (RFC #1264 Phase 2).
 *
 * The stream registry's `publish()` emits each *observable* message here; the
 * event hub subscribes and forwards them to connected clients as `ServerEvent`s.
 * This is purely the live observer feed — distinct from delivery to stream
 * subscribers and from the durable observation log (`stream_messages` table).
 *
 * @module
 */
import { logger } from "./logger.js";

/** A stream message surfaced to live observers. */
export interface StreamMessageEvent {
  /** The stream (room) the message was published to. */
  streamId: string;
  /** ULID transcript sequence key (monotonic per stream). */
  seq: string;
  /** Session id of the sender. */
  senderId: string;
  /** Message content. */
  content: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** Callback invoked for each live stream message. */
export type StreamMessageObserver = (event: StreamMessageEvent) => void;

const observers: Set<StreamMessageObserver> = new Set();

/**
 * Emit a stream message to all live observers. Best-effort: observer errors are
 * isolated so one bad observer can't break publishing or other observers.
 *
 * @param event - The stream message to broadcast.
 */
export function emitStreamMessage(event: StreamMessageEvent): void {
  for (const observer of observers) {
    try {
      observer(event);
    } catch (err) {
      logger.error({ err, streamId: event.streamId }, "Stream-message observer error");
    }
  }
}

/**
 * Register a live stream-message observer.
 *
 * @param observer - Callback invoked for each emitted message.
 * @returns An unsubscribe function.
 */
export function subscribeStreamMessages(observer: StreamMessageObserver): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

/**
 * Clear all observers. For tests only.
 * @internal
 */
export function _resetForTesting(): void {
  observers.clear();
}
