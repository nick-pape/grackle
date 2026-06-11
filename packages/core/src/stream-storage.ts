/**
 * Stream create/get/delete/list operations.
 *
 * Manages the stream lifecycle (creation through deletion). All mutable state
 * lives in {@link ./stream-registry-state.ts}; subscription and delivery teardown
 * in {@link deleteStream} imports from the same state module to keep the operation
 * atomic without coupling storage → subscription or storage → delivery modules.
 */
import { v4 as uuid } from "uuid";
import {
  streams,
  streamsByName,
  subscriptionsBySession,
  subscriptionsById,
  syncQueues,
  pendingDeliveries,
  cleanupSessionIfEmpty,
  emitStreamLifecycle,
} from "./stream-registry-state.js";
import type { Stream } from "./stream-registry-state.js";

export type { Stream } from "./stream-registry-state.js";

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
  emitStreamLifecycle("stream.created", stream, { selfEcho });
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
  emitStreamLifecycle("stream.closed", stream);
}

/** Return all active streams. Used by cleanup phases to scan for orphaned lifecycle streams. */
export function listStreams(): Stream[] {
  return Array.from(streams.values());
}
