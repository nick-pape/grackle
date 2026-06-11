/**
 * Stream subscription management — subscribe, unsubscribe, and fd lookup.
 *
 * All mutable state lives in {@link ./stream-registry-state.ts}.
 */
import { v4 as uuid } from "uuid";
import { LIFECYCLE_PREFIX } from "./stream-names.js";
import {
  streams,
  streamsByName,
  subscriptionsBySession,
  subscriptionsById,
  syncQueues,
  pendingDeliveries,
  revivedCallback,
  AsyncQueue,
  nextFd,
  getSessionFdMap,
  cleanupSessionIfEmpty,
  canReceive,
  emitStreamLifecycle,
} from "./stream-registry-state.js";
import type {
  Subscription,
  Permission,
  DeliveryMode,
  StreamMessage,
} from "./stream-registry-state.js";

export type { Subscription, Permission, DeliveryMode } from "./stream-registry-state.js";

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

  emitStreamLifecycle("stream.attached", stream, { sessionId, permission, deliveryMode });

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
    emitStreamLifecycle("stream.detached", stream, { sessionId: sub.sessionId });
    if (stream.subscriptions.size === 0) {
      // Clean up any pending delivery entries for messages in this stream
      for (const msg of stream.messages) {
        pendingDeliveries.delete(msg.id);
      }
      streamsByName.delete(stream.name);
      streams.delete(sub.streamId);
      emitStreamLifecycle("stream.closed", stream);
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
