/**
 * Lifecycle stream utilities — create and clean up lifecycle and stdin streams.
 *
 * These are shared infrastructure used by event-processor, reanimate-agent,
 * and plugin-core's lifecycle subscriber and handler modules.
 *
 * @module
 */

import * as streamRegistry from "./stream-registry.js";

/**
 * Clean up lifecycle stream for a session. Deletes the stream and all its
 * subscriptions, which triggers the orphan callback (auto-stop).
 *
 * Called from killAgent when explicitly terminating a session, and from the
 * event processor on "failed" status to clean up zombie fds. For sessions
 * that complete normally, lifecycle streams persist until the UI or
 * reconciliation loop closes them — this is intentional (the session stays
 * "alive" and reanimate-safe until someone decides to close the fd).
 */
export function cleanupLifecycleStream(sessionId: string): void {
  const lifecycleStream = streamRegistry.getStreamByName(`lifecycle:${sessionId}`);
  if (lifecycleStream) {
    streamRegistry.deleteStream(lifecycleStream.id);
  }
  // Also clean up stdin stream to prevent it from keeping the session alive
  const stdinStream = streamRegistry.getStreamByName(`stdin:${sessionId}`);
  if (stdinStream) {
    streamRegistry.deleteStream(stdinStream.id);
  }
}

/**
 * Ensure a lifecycle stream exists for a session. Creates the stream with
 * spawner + session subscriptions if it was previously deleted (e.g. by
 * killAgent or a "failed" event). No-op if the stream still exists (e.g.
 * session went idle naturally and lifecycle stream was preserved).
 */
export function ensureLifecycleStream(sessionId: string, spawnerId: string): void {
  const existing = streamRegistry.getStreamByName(`lifecycle:${sessionId}`);
  if (existing) {
    return;
  }
  const stream = streamRegistry.createStream(`lifecycle:${sessionId}`);
  streamRegistry.subscribe(stream.id, spawnerId, "rw", "detach", true);
  streamRegistry.subscribe(stream.id, sessionId, "rw", "detach", false);
}
