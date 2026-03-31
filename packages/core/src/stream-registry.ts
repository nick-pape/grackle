/**
 * In-memory stream registry for agent-to-agent IPC.
 *
 * Streams are global named message channels. Sessions interact with streams
 * through subscriptions (fds) that have permissions (rw/r/w) and delivery
 * modes (sync/async/detach). This is separate from stream-hub.ts, which
 * handles UI event broadcasting.
 *
 * Streams are ephemeral — they don't survive server restart. The session
 * JSONL is the durable state; streams are recreated on reanimate.
 */

import { v4 as uuid } from "uuid";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  /** When true, publishers receive their own messages echoed back (chatroom mode). */
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
class AsyncQueue<T> {
  private queue: T[] = [];
  private waiters: Array<{ resolve: (value: T) => void; reject: (reason: unknown) => void }> = [];
  private closed: boolean = false;

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

// ─── Module State ─────────────────────────────────────────────────────────────

/** All active streams, keyed by stream ID. */
const streams: Map<string, Stream> = new Map();

/** Name → stream ID index for unique-name lookup. */
const streamsByName: Map<string, string> = new Map();

/** All subscriptions for each session, keyed by sessionId → fd → Subscription. */
const subscriptionsBySession: Map<string, Map<number, Subscription>> = new Map();

/** Subscription ID → Subscription (for fast lookup by ID). */
const subscriptionsById: Map<string, Subscription> = new Map();

/** Next fd number for each session (starts at 3, increments). */
const fdCounters: Map<string, number> = new Map();

/** Async message listeners keyed by session ID. Invoked when a message arrives on an async subscription. */
const asyncListeners: Map<string, AsyncMessageListener> = new Map();

/**
 * Pending async delivery Promises for messages whose listeners returned Promises.
 * Keyed by message ID. Populated by publish(); entries are cleaned up by publish()
 * auto-finalization and when streams/subscriptions are deleted or unsubscribed.
 */
const pendingDeliveries: Map<string, { streamId: string; promises: Array<Promise<void>> }> = new Map();

/** Blocking queues for sync subscriptions, keyed by subscription ID. */
const syncQueues: Map<string, AsyncQueue<StreamMessage>> = new Map();

/** Callback invoked when a session has zero remaining subscriptions (orphaned). */
type OrphanCallback = (sessionId: string) => void;
let orphanCallback: OrphanCallback | undefined;

/** Callback invoked when an external subscription is created on a lifecycle stream. */
type RevivedCallback = (targetSessionId: string, subscriberSessionId: string) => void;
let revivedCallback: RevivedCallback | undefined;

/** Prefix for lifecycle stream names. */
const LIFECYCLE_PREFIX: string = "lifecycle:";

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/** Allocate the next fd number for a session. */
function nextFd(sessionId: string): number {
  const current = fdCounters.get(sessionId) ?? 3;
  fdCounters.set(sessionId, current + 1);
  return current;
}

/** Get or create the fd map for a session. */
function getSessionFdMap(sessionId: string): Map<number, Subscription> {
  let fdMap = subscriptionsBySession.get(sessionId);
  if (!fdMap) {
    fdMap = new Map();
    subscriptionsBySession.set(sessionId, fdMap);
  }
  return fdMap;
}

/** Clean up session state when it has no more subscriptions. Fires orphan callback. */
function cleanupSessionIfEmpty(sessionId: string): void {
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

/** Check if a subscription can receive messages (has read permission). */
function canReceive(sub: Subscription): boolean {
  return sub.permission === "rw" || sub.permission === "r";
}

/**
 * Prune messages that have been delivered to all readable subscriptions.
 * Keeps memory bounded by removing messages no longer needed for hasUndeliveredMessages.
 */
function pruneDeliveredMessages(stream: Stream): void {
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

// ─── Stream Lifecycle ─────────────────────────────────────────────────────────

/** Create a new named stream. Names must be unique — throws if a stream with the same name exists. */
export function createStream(name: string, selfEcho: boolean = false): Stream {
  if (streamsByName.has(name)) {
    throw new Error(`Stream with name "${name}" already exists`);
  }

  const stream: Stream = {
    id: uuid(),
    name,
    messages: [],
    subscriptions: new Map(),
    selfEcho,
  };
  streams.set(stream.id, stream);
  streamsByName.set(name, stream.id);
  return stream;
}

/** Retrieve a stream by ID. */
export function getStream(id: string): Stream | undefined {
  return streams.get(id);
}

/** Retrieve a stream by name. */
export function getStreamByName(name: string): Stream | undefined {
  const id = streamsByName.get(name);
  return id ? streams.get(id) : undefined;
}

/** Remove a stream and all its subscriptions. */
export function deleteStream(id: string): void {
  const stream = streams.get(id);
  if (!stream) {
    return;
  }
  // Clean up all subscriptions on this stream
  for (const sub of stream.subscriptions.values()) {
    subscriptionsById.delete(sub.id);
    const queue = syncQueues.get(sub.id);
    if (queue) {
      queue.close();
      syncQueues.delete(sub.id);
    }
    const fdMap = subscriptionsBySession.get(sub.sessionId);
    if (fdMap) {
      fdMap.delete(sub.fd);
      cleanupSessionIfEmpty(sub.sessionId);
    }
  }
  // Clean up any pending delivery entries for messages in this stream
  for (const msg of stream.messages) {
    pendingDeliveries.delete(msg.id);
  }
  streamsByName.delete(stream.name);
  streams.delete(id);
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

/** Create a subscription (fd) for a session on a stream. */
export function subscribe(
  streamId: string,
  sessionId: string,
  permission: Permission,
  deliveryMode: DeliveryMode,
  createdBySpawn: boolean,
): Subscription {
  const stream = streams.get(streamId);
  if (!stream) {
    throw new Error(`Stream not found: ${streamId}`);
  }

  // w-only subscriptions cannot have sync or async delivery (they never receive)
  if (permission === "w" && (deliveryMode === "sync" || deliveryMode === "async")) {
    throw new Error(`Write-only subscription cannot use "${deliveryMode}" delivery mode`);
  }

  const fd = nextFd(sessionId);
  const sub: Subscription = {
    id: uuid(),
    fd,
    streamId,
    sessionId,
    permission,
    deliveryMode,
    createdBySpawn,
  };

  stream.subscriptions.set(sub.id, sub);
  getSessionFdMap(sessionId).set(fd, sub);
  subscriptionsById.set(sub.id, sub);

  // Create a blocking queue for sync subscriptions (only readable ones)
  if (deliveryMode === "sync" && canReceive(sub)) {
    syncQueues.set(sub.id, new AsyncQueue<StreamMessage>());
  }

  // Fire revived callback when an external session subscribes to a lifecycle stream.
  // "External" means the subscriber is not the target session itself.
  if (revivedCallback && stream.name.startsWith(LIFECYCLE_PREFIX)) {
    const targetSessionId: string = stream.name.slice(LIFECYCLE_PREFIX.length);
    if (sessionId !== targetSessionId) {
      try {
        revivedCallback(targetSessionId, sessionId);
      } catch (err) {
        console.debug("stream-registry: revived callback error for", targetSessionId, err);
      }
    }
  }

  return sub;
}

/** Remove a subscription. Deletes the stream if it was the last subscription. */
export function unsubscribe(subscriptionId: string): void {
  const sub = subscriptionsById.get(subscriptionId);
  if (!sub) {
    return;
  }

  // Close and remove sync queue (unblocks any pending consumeSync)
  const queue = syncQueues.get(sub.id);
  if (queue) {
    queue.close();
    syncQueues.delete(sub.id);
  }

  // Remove from stream
  const stream = streams.get(sub.streamId);
  if (stream) {
    stream.subscriptions.delete(sub.id);
    if (stream.subscriptions.size === 0) {
      // Clean up any pending delivery entries for messages in this stream
      for (const msg of stream.messages) {
        pendingDeliveries.delete(msg.id);
      }
      streamsByName.delete(stream.name);
      streams.delete(sub.streamId);
    }
  }

  // Remove from session fd map
  const fdMap = subscriptionsBySession.get(sub.sessionId);
  if (fdMap) {
    fdMap.delete(sub.fd);
    cleanupSessionIfEmpty(sub.sessionId);
  }

  // Remove from lookup maps
  subscriptionsById.delete(sub.id);
}

/** Look up a subscription by session ID and fd number. */
export function getSubscription(sessionId: string, fd: number): Subscription | undefined {
  return subscriptionsBySession.get(sessionId)?.get(fd);
}

/** Get all subscriptions for a session. */
export function getSubscriptionsForSession(sessionId: string): Subscription[] {
  const fdMap = subscriptionsBySession.get(sessionId);
  if (!fdMap) {
    return [];
  }
  return Array.from(fdMap.values());
}

/** Get only subscriptions that this session opened via spawn() (not inherited). */
export function getOwnedSubscriptions(sessionId: string): Subscription[] {
  return getSubscriptionsForSession(sessionId).filter((s) => s.createdBySpawn);
}

// ─── Messaging ────────────────────────────────────────────────────────────────

/** Publish a message to a stream. Notifies async subscribers and enqueues for sync subscribers. */
export function publish(streamId: string, senderId: string, content: string): StreamMessage {
  const stream = streams.get(streamId);
  if (!stream) {
    throw new Error(`Stream not found: ${streamId}`);
  }

  const msg: StreamMessage = {
    id: uuid(),
    senderId,
    content,
    timestamp: new Date().toISOString(),
    deliveredTo: new Set(),
  };

  stream.messages.push(msg);

  // Notify subscribers (skip write-only subscriptions; skip sender unless self-echo is enabled)
  for (const sub of stream.subscriptions.values()) {
    if (!stream.selfEcho && sub.sessionId === senderId) {
      continue;
    }
    if (!canReceive(sub)) {
      continue;
    }

    if (sub.deliveryMode === "async") {
      // Only mark as delivered if the listener exists and succeeds
      const listener = asyncListeners.get(sub.sessionId);
      if (listener) {
        try {
          const result = listener(sub, msg);
          // Check for a thenable: void return (undefined) is the backward-compat path;
          // any non-undefined value with a .then function is treated as a Promise.
          // Accessing .then on a non-object (e.g. null from an untyped caller) would
          // throw and be caught by the surrounding catch block, leaving the message undelivered.
          if (result !== undefined && typeof (result as Promise<void>).then === "function") {
            // Async listener — defer delivery tracking until the Promise settles
            const subId = sub.id;
            const streamId = sub.streamId;
            const deliveryPromise = (result as Promise<void>).then(
              () => { msg.deliveredTo.add(subId); },
              (err: unknown) => { logger.warn({ err, subscriptionId: subId }, "Async listener delivery failed — message left undelivered"); },
            );
            let pending = pendingDeliveries.get(msg.id);
            if (!pending) {
              pending = { streamId, promises: [] };
              pendingDeliveries.set(msg.id, pending);
            }
            pending.promises.push(deliveryPromise);
          } else {
            // Synchronous listener — mark delivered immediately (backward compatible)
            msg.deliveredTo.add(sub.id);
          }
        } catch (err) {
          logger.warn({ err, subscriptionId: sub.id }, "Async listener threw — message left undelivered");
        }
      }
      // No listener registered: message stays undelivered (buffered)
    } else if (sub.deliveryMode === "sync") {
      // Enqueue for blocking consumeSync()
      const queue = syncQueues.get(sub.id);
      if (queue) {
        queue.push(msg);
      }
    }
    // "detach" mode: message stays in buffer, no notification
  }

  // If there are pending async deliveries, schedule auto-finalization so that callers
  // that do not call awaitPendingDeliveries() still get pruning once all Promises settle.
  // This prevents fully-delivered messages from leaking in stream.messages indefinitely
  // (e.g. stdin delivery never calls awaitPendingDeliveries).
  const pending = pendingDeliveries.get(msg.id);
  if (!pending) {
    pruneDeliveredMessages(stream);
  } else {
    const streamId = stream.id;
    Promise.allSettled(pending.promises).then(() => {
      // Only clean up if this entry still exists; it may already have been removed by
      // a previous auto-finalization pass or by stream teardown (deleteStream/unsubscribe/_resetForTesting).
      if (pendingDeliveries.has(msg.id)) {
        pendingDeliveries.delete(msg.id);
        const s = streams.get(streamId);
        if (s) {
          pruneDeliveredMessages(s);
        }
      }
    }).catch((err: unknown) => {
      // allSettled never rejects; this catches unexpected errors in the pruning logic
      logger.error({ err, streamId, messageId: msg.id }, "Error while finalizing async deliveries for stream");
    });
  }

  return msg;
}

/** Block until an undelivered message is available for this sync subscription. */
export async function consumeSync(subscriptionId: string): Promise<StreamMessage> {
  const queue = syncQueues.get(subscriptionId);
  if (!queue) {
    throw new Error(`No sync queue for subscription: ${subscriptionId}. Is it a sync subscription?`);
  }

  const msg = await queue.shift();
  msg.deliveredTo.add(subscriptionId);
  return msg;
}

/** Check if there are messages in the stream buffer not yet delivered to this subscription. */
export function hasUndeliveredMessages(subscriptionId: string): boolean {
  const sub = subscriptionsById.get(subscriptionId);
  if (!sub) {
    return false;
  }

  // Write-only subscriptions can never consume messages
  if (!canReceive(sub)) {
    return false;
  }

  const stream = streams.get(sub.streamId);
  if (!stream) {
    return false;
  }

  return stream.messages.some(
    (msg) =>
      !msg.deliveredTo.has(subscriptionId) &&
      (stream.selfEcho || msg.senderId !== sub.sessionId),
  );
}

// ─── Notification Registration ────────────────────────────────────────────────

/**
 * Register a callback invoked when a message arrives on any async subscription
 * for the given session. Returns an unsubscribe function.
 */
export function registerAsyncListener(sessionId: string, callback: AsyncMessageListener): () => void {
  asyncListeners.set(sessionId, callback);
  return () => {
    asyncListeners.delete(sessionId);
  };
}

/**
 * Await all in-flight async delivery Promises for a message.
 *
 * Callers that need guaranteed delivery confirmation (e.g., `writeToFd`, `publishChildCompletion`)
 * should call this after `publish()`. Messages delivered by a synchronous listener are already
 * marked delivered and have no pending entries, so this is a no-op for them.
 *
 * Cleanup (deleting the pending entry and pruning) is handled exclusively by the
 * auto-finalize scheduled inside `publish()`, so this function is a pure barrier.
 *
 * Note: pruning is driven by `publish()`'s auto-finalize (`Promise.allSettled`) and runs
 * independently of this barrier. Callers must not assume any particular pruning state
 * when this returns — only that `msg.deliveredTo` is accurate and `hasUndeliveredMessages`
 * returns the correct value.
 */
export async function awaitPendingDeliveries(msg: StreamMessage): Promise<void> {
  const entry = pendingDeliveries.get(msg.id);
  if (!entry || entry.promises.length === 0) {
    return;
  }
  await Promise.all(entry.promises);
  // No cleanup here — publish()'s Promise.allSettled auto-finalize owns that exclusively,
  // eliminating any race between this barrier and the background finalization.
}

// ─── Lifecycle Callbacks ──────────────────────────────────────────────────────

/**
 * Register a callback invoked when a session has zero remaining subscriptions.
 * Used by the lifecycle manager to auto-hibernate orphaned sessions.
 *
 * **Singleton semantics**: only one callback is supported at a time. A new
 * registration overwrites the previous one (last-wins). This is intentional —
 * there is exactly one lifecycle manager per server instance.
 *
 * @returns An unsubscribe function that removes the callback.
 */
export function onSessionOrphaned(cb: OrphanCallback): () => void {
  orphanCallback = cb;
  return () => {
    if (orphanCallback === cb) {
      orphanCallback = undefined;
    }
  };
}

/**
 * Register a callback invoked when an external session subscribes to a
 * lifecycle stream. Used by the lifecycle manager to auto-reanimate
 * stopped sessions when a new fd is opened.
 *
 * **Singleton semantics**: only one callback is supported at a time. A new
 * registration overwrites the previous one (last-wins). This is intentional —
 * there is exactly one lifecycle manager per server instance.
 *
 * @returns An unsubscribe function that removes the callback.
 */
export function onSessionRevived(cb: RevivedCallback): () => void {
  revivedCallback = cb;
  return () => {
    if (revivedCallback === cb) {
      revivedCallback = undefined;
    }
  };
}

// ─── Enumeration ──────────────────────────────────────────────────────────────

/** Return all active streams. Used by cleanup phases to scan for orphaned lifecycle streams. */
export function listStreams(): Stream[] {
  return Array.from(streams.values());
}

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
