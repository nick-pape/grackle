/**
 * Shared types, mutable state, and internal helpers for the stream-registry subsystem.
 *
 * All public types, Maps, callback slots, the AsyncQueue class, and the private
 * helper functions that mutate them live here. The focused operation modules
 * ({@link ./stream-storage.ts}, {@link ./subscription-manager.ts},
 * {@link ./message-delivery.ts}) import from this module rather than duplicating
 * state, making cross-concern coupling explicit instead of ambient.
 *
 * Nothing below the "Types" section is part of the public API — it is `@internal`.
 */
import { monotonicFactory } from "ulid";
import { logger } from "./logger.js";
import { isReservedStreamName } from "./stream-names.js";
import { emit, type GrackleEventType } from "./event-bus.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

/** Permission level for a subscription. */
export type Permission = "rw" | "r" | "w";

/** How a subscriber receives messages. */
export type DeliveryMode = "sync" | "async" | "detach";

/** A global named message channel. */
export interface Stream {
  readonly id: string;
  readonly name: string;
  readonly messages: StreamMessage[];
  readonly subscriptions: Map<string, Subscription>;
  /**
   * When true, a publisher's own messages are still recorded in stream history and may be
   * consumed back by that same session through sync/detach subscription paths. Sender-owned
   * async subscriptions are an exception: their async listeners are NOT invoked for the
   * publisher's own messages. This prevents the sender from triggering a full agent turn on
   * their own output (chatroom mode). (#1184)
   */
  readonly selfEcho: boolean;
}

/** A message published to a stream. */
export interface StreamMessage {
  readonly id: string;
  readonly senderId: string;
  readonly content: string;
  readonly timestamp: string;
  /** Subscription IDs that have consumed this message. */
  readonly deliveredTo: Set<string>;
}

/** A session's reference to a stream (an "fd"). */
export interface Subscription {
  readonly id: string;
  readonly fd: number;
  readonly streamId: string;
  readonly sessionId: string;
  readonly permission: Permission;
  readonly deliveryMode: DeliveryMode;
  /** True if the session opened this fd via spawn(); false if inherited from parent. */
  readonly createdBySpawn: boolean;
}

/** Callback invoked when a message arrives on an async subscription. May return a Promise to defer delivery tracking. */
export type AsyncMessageListener = (sub: Subscription, msg: StreamMessage) => void | Promise<void>;

// ─── Async Queue (blocking reads for sync subscriptions) ──────────────────────

/** Simple async queue for blocking consume. Rejects pending waiters on close. */
export class AsyncQueue<T> {
  private queue: T[] = [];
  private waiters: Array<{ resolve: (value: T) => void; reject: (reason: unknown) => void }> = [];
  private closed: boolean = false;

  /** Push an item; if a waiter is pending, resolve it immediately. */
  public push(item: T): void {
    if (this.closed) {
      return;
    }
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve(item);
    } else {
      this.queue.push(item);
    }
  }

  /** Dequeue the next item, blocking until one is available. */
  public async shift(): Promise<T> {
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    if (this.closed) {
      throw new Error("Queue is closed");
    }
    return new Promise<T>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /** Close the queue. Rejects all pending waiters so blocked consumers unblock. */
  public close(): void {
    this.closed = true;
    const err = new Error("Subscription closed");
    for (const waiter of this.waiters) {
      waiter.reject(err);
    }
    this.waiters.length = 0;
  }
}

// ─── Module-level state ───────────────────────────────────────────────────────

/** All active streams, keyed by stream ID. @internal */
export const streams: Map<string, Stream> = new Map();

/** Name → stream ID index for unique-name lookup. @internal */
export const streamsByName: Map<string, string> = new Map();

/** All subscriptions for each session, keyed by sessionId → fd → Subscription. @internal */
export const subscriptionsBySession: Map<string, Map<number, Subscription>> = new Map();

/** Subscription ID → Subscription (for fast lookup by ID). @internal */
export const subscriptionsById: Map<string, Subscription> = new Map();

/** Next fd number for each session (starts at 3, increments). @internal */
export const fdCounters: Map<string, number> = new Map();

/** Async message listeners keyed by session ID. @internal */
export const asyncListeners: Map<string, AsyncMessageListener> = new Map();

/**
 * Pending async delivery Promises for messages whose listeners returned Promises.
 * Keyed by message ID. Populated by publish() and replayUndeliveredMessages().
 * Entries are cleaned up by auto-finalization and when streams/subscriptions are
 * deleted or unsubscribed.
 *
 * `inflightSubIds` tracks which subscription IDs have a delivery Promise currently
 * in flight for this message. Used by replayUndeliveredMessages() to skip duplicate
 * dispatch when called again before the prior delivery Promise settles.
 * @internal
 */
export const pendingDeliveries: Map<
  string,
  { streamId: string; promises: Array<Promise<void>>; inflightSubIds: Set<string> }
> = new Map();

/** Blocking queues for sync subscriptions, keyed by subscription ID. @internal */
export const syncQueues: Map<string, AsyncQueue<StreamMessage>> = new Map();

/** @internal */
type OrphanCallback = (sessionId: string) => void;
/** @internal */
export let orphanCallback: OrphanCallback | undefined;
/** Set or clear the orphan callback (singleton). @internal */
export function setOrphanCallback(cb: OrphanCallback | undefined): void {
  orphanCallback = cb;
}

/** @internal */
type RevivedCallback = (targetSessionId: string, subscriberSessionId: string) => void;
/** @internal */
export let revivedCallback: RevivedCallback | undefined;
/** Set or clear the revived callback (singleton). @internal */
export function setRevivedCallback(cb: RevivedCallback | undefined): void {
  revivedCallback = cb;
}

// ─── Internal helpers shared by operation modules ────────────────────────────

/** Allocate the next fd number for a session. @internal */
export function nextFd(sessionId: string): number {
  const current = fdCounters.get(sessionId) ?? 3;
  fdCounters.set(sessionId, current + 1);
  return current;
}

/** Get or create the fd map for a session. @internal */
export function getSessionFdMap(sessionId: string): Map<number, Subscription> {
  let fdMap = subscriptionsBySession.get(sessionId);
  if (!fdMap) {
    fdMap = new Map();
    subscriptionsBySession.set(sessionId, fdMap);
  }
  return fdMap;
}

/** Clean up session state when it has no more subscriptions. Fires orphan callback. @internal */
export function cleanupSessionIfEmpty(sessionId: string): void {
  const fdMap = subscriptionsBySession.get(sessionId);
  if (fdMap?.size === 0) {
    subscriptionsBySession.delete(sessionId);
    fdCounters.delete(sessionId);
    try {
      orphanCallback?.(sessionId);
    } catch (err) {
      // Best-effort — orphan callback errors must not break stream-registry cleanup.
      // Log at debug level for diagnosability.
      console.debug("stream-registry: orphan callback error for", sessionId, err);
    }
  }
}

/** Check if a subscription can receive messages (has read permission). @internal */
export function canReceive(sub: Subscription): boolean {
  return sub.permission === "rw" || sub.permission === "r";
}

/**
 * Prune messages that have been delivered to all readable subscriptions.
 * Keeps memory bounded by removing messages no longer needed for hasUndeliveredMessages.
 * @internal
 */
export function pruneDeliveredMessages(stream: Stream): void {
  const readableSubs = Array.from(stream.subscriptions.values()).filter(canReceive);
  if (readableSubs.length === 0) {
    stream.messages.length = 0;
    return;
  }

  let pruneCount = 0;
  for (const msg of stream.messages) {
    const allDelivered = readableSubs.every(
      (sub) => msg.deliveredTo.has(sub.id) || (!stream.selfEcho && msg.senderId === sub.sessionId),
    );
    if (allDelivered) {
      pruneCount++;
    } else {
      break; // Messages are ordered; stop at first undelivered
    }
  }
  if (pruneCount > 0) {
    stream.messages.splice(0, pruneCount);
  }
}

/** Lifecycle event types emitted for observable rooms (#1309). @internal */
type StreamLifecycleType = Extract<
  GrackleEventType,
  "stream.created" | "stream.attached" | "stream.detached" | "stream.closed"
>;

/**
 * Emit a room lifecycle domain event for an observable (non-reserved) stream so
 * the Coordination roster stays live (#1309). Reserved plumbing streams
 * (lifecycle:/pipe:/stdin:) are excluded — same boundary as the durable
 * observation log in publish(). Best-effort: a domain-event failure must never
 * break subscription bookkeeping.
 * @internal
 */
export function emitStreamLifecycle(
  type: StreamLifecycleType,
  stream: Stream,
  extra: Record<string, unknown> = {},
): void {
  if (isReservedStreamName(stream.name)) {
    return;
  }
  try {
    emit(type, { streamId: stream.id, name: stream.name, ...extra });
  } catch (err) {
    logger.error({ err, streamId: stream.id, type }, "Failed to emit stream lifecycle event");
  }
}

/**
 * Monotonic ULID generator for transcript sequence keys. Unlike plain `ulid()`,
 * this is strictly increasing even when multiple messages are published within
 * the same millisecond, so transcript `seq` always reflects publish order under
 * bursty traffic (RFC #1264 Phase 2).
 * @internal
 */
export const nextStreamSeq: () => string = monotonicFactory();

// ─── Testing ──────────────────────────────────────────────────────────────────

/** Clear all state. For testing only. */
export function _resetForTesting(): void {
  streams.clear();
  streamsByName.clear();
  subscriptionsBySession.clear();
  subscriptionsById.clear();
  fdCounters.clear();
  asyncListeners.clear();
  pendingDeliveries.clear();
  // Close all sync queues before clearing
  for (const queue of syncQueues.values()) {
    queue.close();
  }
  syncQueues.clear();
  orphanCallback = undefined;
  revivedCallback = undefined;
}
