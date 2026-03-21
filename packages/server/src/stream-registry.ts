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

/** Callback invoked when a message arrives on an async subscription. */
export type AsyncMessageListener = (sub: Subscription, msg: StreamMessage) => void;

// ─── Async Queue (blocking reads for sync subscriptions) ──────────────────────

/** Simple async queue for blocking consume. Matches powerline's AsyncQueue pattern. */
class AsyncQueue<T> {
  private queue: T[] = [];
  private waiters: Array<(value: T) => void> = [];

  public push(item: T): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter(item);
    } else {
      this.queue.push(item);
    }
  }

  public async shift(): Promise<T> {
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

// ─── Module State ─────────────────────────────────────────────────────────────

/** All active streams, keyed by stream ID. */
const streams: Map<string, Stream> = new Map();

/** All subscriptions for each session, keyed by sessionId → fd → Subscription. */
const subscriptionsBySession: Map<string, Map<number, Subscription>> = new Map();

/** Subscription ID → Subscription (for fast lookup by ID). */
const subscriptionsById: Map<string, Subscription> = new Map();

/** Next fd number for each session (starts at 3, increments). */
const fdCounters: Map<string, number> = new Map();

/** Async message listeners keyed by session ID. Invoked when a message arrives on an async subscription. */
const asyncListeners: Map<string, AsyncMessageListener> = new Map();

/** Blocking queues for sync subscriptions, keyed by subscription ID. */
const syncQueues: Map<string, AsyncQueue<StreamMessage>> = new Map();

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

// ─── Stream Lifecycle ─────────────────────────────────────────────────────────

/** Create a new named stream. Returns the stream. */
export function createStream(name: string): Stream {
  const stream: Stream = {
    id: uuid(),
    name,
    messages: [],
    subscriptions: new Map(),
  };
  streams.set(stream.id, stream);
  return stream;
}

/** Retrieve a stream by ID. */
export function getStream(id: string): Stream | undefined {
  return streams.get(id);
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
    syncQueues.delete(sub.id);
    const fdMap = subscriptionsBySession.get(sub.sessionId);
    if (fdMap) {
      fdMap.delete(sub.fd);
      if (fdMap.size === 0) {
        subscriptionsBySession.delete(sub.sessionId);
      }
    }
  }
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

  // Create a blocking queue for sync subscriptions
  if (deliveryMode === "sync") {
    syncQueues.set(sub.id, new AsyncQueue<StreamMessage>());
  }

  return sub;
}

/** Remove a subscription. Deletes the stream if it was the last subscription. */
export function unsubscribe(subscriptionId: string): void {
  const sub = subscriptionsById.get(subscriptionId);
  if (!sub) {
    return;
  }

  // Remove from stream
  const stream = streams.get(sub.streamId);
  if (stream) {
    stream.subscriptions.delete(sub.id);
    if (stream.subscriptions.size === 0) {
      streams.delete(sub.streamId);
    }
  }

  // Remove from session fd map
  const fdMap = subscriptionsBySession.get(sub.sessionId);
  if (fdMap) {
    fdMap.delete(sub.fd);
    if (fdMap.size === 0) {
      subscriptionsBySession.delete(sub.sessionId);
    }
  }

  // Remove from lookup maps
  subscriptionsById.delete(sub.id);
  syncQueues.delete(sub.id);
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

  // Notify subscribers (skip the sender)
  for (const sub of stream.subscriptions.values()) {
    if (sub.sessionId === senderId) {
      continue;
    }

    if (sub.deliveryMode === "async") {
      // Mark as delivered and invoke the async listener
      msg.deliveredTo.add(sub.id);
      const listener = asyncListeners.get(sub.sessionId);
      if (listener) {
        listener(sub, msg);
      }
    } else if (sub.deliveryMode === "sync") {
      // Enqueue for blocking consumeSync()
      const queue = syncQueues.get(sub.id);
      if (queue) {
        queue.push(msg);
      }
    }
    // "detach" mode: message stays in buffer, no notification
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

  const stream = streams.get(sub.streamId);
  if (!stream) {
    return false;
  }

  return stream.messages.some((msg) => !msg.deliveredTo.has(subscriptionId) && msg.senderId !== sub.sessionId);
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

// ─── Testing ──────────────────────────────────────────────────────────────────

/** Clear all state. For testing only. */
export function _resetForTesting(): void {
  streams.clear();
  subscriptionsBySession.clear();
  subscriptionsById.clear();
  fdCounters.clear();
  asyncListeners.clear();
  syncQueues.clear();
}
