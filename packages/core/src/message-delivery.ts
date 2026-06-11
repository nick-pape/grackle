/**
 * Stream message publishing, sync consumption, replay, and pending-delivery barriers.
 *
 * All mutable state lives in {@link ./stream-registry-state.ts}.
 */
import { v4 as uuid } from "uuid";
import { serverTimestamp } from "@grackle-ai/common";
import { getDatabaseStores } from "@grackle-ai/database";
import { logger } from "./logger.js";
import { isReservedStreamName } from "./stream-names.js";
import { emitStreamMessage } from "./stream-message-bus.js";
import {
  streams,
  subscriptionsById,
  asyncListeners,
  pendingDeliveries,
  syncQueues,
  nextStreamSeq,
  canReceive,
  pruneDeliveredMessages,
} from "./stream-registry-state.js";
import type { StreamMessage, AsyncMessageListener } from "./stream-registry-state.js";

export type { StreamMessage, AsyncMessageListener } from "./stream-registry-state.js";

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
    timestamp: serverTimestamp(),
    deliveredTo: new Set(),
  };

  stream.messages.push(msg);

  // Durable observation log + live observer feed, for user-facing rooms only
  // (RFC #1264 Phase 2). Internal plumbing (pipe:/stdin:/lifecycle:) is excluded.
  // Persist and emit are independent best-effort paths in their own try/catch:
  // neither may break message delivery, and a DB outage must not also suppress
  // the live feed (so the UI/CLI keep seeing messages while persistence fails).
  if (!isReservedStreamName(stream.name)) {
    const seq: string = nextStreamSeq();
    try {
      getDatabaseStores().streamMessageStore.persistStreamMessage({
        seq,
        streamId: stream.id,
        senderId: msg.senderId,
        content: msg.content,
        timestamp: msg.timestamp,
      });
    } catch (err) {
      logger.error({ err, streamId: stream.id }, "Failed to persist stream message");
    }
    try {
      emitStreamMessage({
        streamId: stream.id,
        seq,
        senderId: msg.senderId,
        content: msg.content,
        timestamp: msg.timestamp,
      });
    } catch (err) {
      logger.error({ err, streamId: stream.id }, "Failed to emit stream message");
    }
  }

  // Notify subscribers (skip write-only subscriptions; skip sender unless self-echo is enabled)
  for (const sub of stream.subscriptions.values()) {
    if (!stream.selfEcho && sub.sessionId === senderId) {
      continue;
    }
    if (!canReceive(sub)) {
      continue;
    }

    if (sub.deliveryMode === "async") {
      // Self-echo: skip async listener to prevent sender from triggering a full
      // agent turn on their own output. Mark delivered to prevent memory leak. (#1184)
      if (stream.selfEcho && sub.sessionId === senderId) {
        msg.deliveredTo.add(sub.id);
        continue;
      }
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
            const currentStreamId = sub.streamId;
            const deliveryPromise = (result as Promise<void>).then(
              () => {
                msg.deliveredTo.add(subId);
              },
              (err: unknown) => {
                logger.warn(
                  { err, subscriptionId: subId },
                  "Async listener delivery failed — message left undelivered",
                );
              },
            );
            let pending = pendingDeliveries.get(msg.id);
            if (!pending) {
              pending = { streamId: currentStreamId, promises: [], inflightSubIds: new Set() };
              pendingDeliveries.set(msg.id, pending);
            }
            pending.promises.push(deliveryPromise);
          } else {
            // Synchronous listener — mark delivered immediately (backward compatible)
            msg.deliveredTo.add(sub.id);
          }
        } catch (err) {
          logger.warn(
            { err, subscriptionId: sub.id },
            "Async listener threw — message left undelivered",
          );
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
    const currentStreamId = stream.id;
    Promise.allSettled(pending.promises)
      .then(() => {
        // Only clean up if this entry still exists; it may already have been removed by
        // a previous auto-finalization pass or by stream teardown (deleteStream/unsubscribe/_resetForTesting).
        if (pendingDeliveries.has(msg.id)) {
          pendingDeliveries.delete(msg.id);
          const s = streams.get(currentStreamId);
          if (s) {
            pruneDeliveredMessages(s);
          }
        }
      })
      .catch((err: unknown) => {
        // allSettled never rejects; this catches unexpected errors in the pruning logic
        logger.error(
          { err, streamId: currentStreamId, messageId: msg.id },
          "Error while finalizing async deliveries for stream",
        );
      });
  }

  return msg;
}

/** Block until an undelivered message is available for this sync subscription. */
export async function consumeSync(subscriptionId: string): Promise<StreamMessage> {
  const queue = syncQueues.get(subscriptionId);
  if (!queue) {
    throw new Error(
      `No sync queue for subscription: ${subscriptionId}. Is it a sync subscription?`,
    );
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
      !msg.deliveredTo.has(subscriptionId) && (stream.selfEcho || msg.senderId !== sub.sessionId),
  );
}

/**
 * Replay any buffered messages that have not yet been delivered to the given subscription.
 *
 * Called after re-registering an async listener for a session that was suspended and
 * reanimated. The stream buffer may hold messages that arrived during the disconnection
 * window and were left undelivered (the listener threw because the environment was offline).
 * Re-invoking the listener for each such message brings the subscriber up to date.
 *
 * No-ops if the subscription is not found, is write-only, or has no registered async listener.
 */
export function replayUndeliveredMessages(subscriptionId: string): void {
  const sub = subscriptionsById.get(subscriptionId);
  if (!sub || !canReceive(sub) || sub.deliveryMode !== "async") {
    return;
  }

  const stream = streams.get(sub.streamId);
  if (!stream) {
    return;
  }

  const listener = asyncListeners.get(sub.sessionId);
  if (!listener) {
    return;
  }

  let hadSyncDelivery = false;
  /** Message IDs for which we added an async delivery promise in this call. */
  const asyncMessageIds: string[] = [];

  for (const msg of stream.messages) {
    if (msg.deliveredTo.has(subscriptionId)) {
      continue;
    }
    if (!stream.selfEcho && msg.senderId === sub.sessionId) {
      continue;
    }

    // Skip if a delivery Promise for this (message, subscription) pair is already in flight.
    // Without this guard, a second replay call before the first Promise settles would
    // re-invoke the listener and dispatch a duplicate sendInput.
    const existingPending = pendingDeliveries.get(msg.id);
    if (existingPending?.inflightSubIds.has(sub.id)) {
      continue;
    }

    try {
      const result = listener(sub, msg);
      if (result !== undefined && typeof (result as Promise<void>).then === "function") {
        const subId = sub.id;
        const currentStreamId = sub.streamId;
        let pending = pendingDeliveries.get(msg.id);
        if (!pending) {
          pending = { streamId: currentStreamId, promises: [], inflightSubIds: new Set() };
          pendingDeliveries.set(msg.id, pending);
        }
        pending.inflightSubIds.add(subId);
        const deliveryPromise = (result as Promise<void>).then(
          () => {
            msg.deliveredTo.add(subId);
            pending!.inflightSubIds.delete(subId);
          },
          (err: unknown) => {
            logger.warn(
              { err, subscriptionId: subId },
              "replayUndeliveredMessages: async listener delivery failed",
            );
            pending!.inflightSubIds.delete(subId);
          },
        );
        pending.promises.push(deliveryPromise);
        asyncMessageIds.push(msg.id);
      } else {
        msg.deliveredTo.add(sub.id);
        hadSyncDelivery = true;
      }
    } catch (err) {
      logger.warn(
        { err, subscriptionId: sub.id },
        "replayUndeliveredMessages: async listener threw — message left undelivered",
      );
    }
  }

  // Schedule one finalization per message after the loop — matching publish() exactly.
  // Scheduling after the loop (rather than inside it) guarantees pending.promises is fully
  // populated before allSettled is called, so no sibling promise can be dropped.
  for (const msgId of asyncMessageIds) {
    const pending = pendingDeliveries.get(msgId);
    if (pending) {
      const currentStreamId = pending.streamId;
      Promise.allSettled(pending.promises)
        .then(() => {
          if (pendingDeliveries.has(msgId)) {
            pendingDeliveries.delete(msgId);
            const s = streams.get(currentStreamId);
            if (s) {
              pruneDeliveredMessages(s);
            }
          }
        })
        .catch((err: unknown) => {
          logger.error(
            { err, streamId: currentStreamId, messageId: msgId },
            "replayUndeliveredMessages: error during auto-finalization",
          );
        });
    }
  }

  // Prune after all sync deliveries — publish() does the same when there are no async promises.
  if (hadSyncDelivery) {
    pruneDeliveredMessages(stream);
  }
}

/**
 * Register a callback invoked when a message arrives on any async subscription
 * for the given session. Returns an unsubscribe function.
 */
export function registerAsyncListener(
  sessionId: string,
  callback: AsyncMessageListener,
): () => void {
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
