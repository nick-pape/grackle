/**
 * Stdin stream delivery — routes human→agent input through the stream-registry.
 *
 * Each session gets a `stdin:{sessionId}` stream at spawn time. The server
 * holds a write-only fd; the session holds a read-only fd with async delivery.
 * When `sendInput` is called, the message is published to the stdin stream
 * and the async listener delivers it to PowerLine — same pattern as pipe
 * delivery, but without the `[fd:N]` prefix.
 *
 * @module
 */

import * as streamRegistry from "./stream-registry.js";
import { ensureAsyncDeliveryListener } from "./pipe-delivery.js";

/** Pseudo session ID used by the server for stdin write subscriptions. */
const SERVER_SESSION_ID: string = "__server__";

/** Prefix for stdin stream names. */
const STDIN_PREFIX: string = "stdin:";

/**
 * Create a stdin stream for a session if it does not already exist.
 *
 * Idempotent — safe to call multiple times for the same session.
 *
 * Creates:
 * - Server subscription: write-only / detach (publishes user input)
 * - Session subscription: read-only / async (receives via async listener → PowerLine)
 */
export function ensureStdinStream(sessionId: string): void {
  const name = `${STDIN_PREFIX}${sessionId}`;
  if (streamRegistry.getStreamByName(name)) {
    return;
  }

  const stream = streamRegistry.createStream(name);
  streamRegistry.subscribe(stream.id, SERVER_SESSION_ID, "w", "detach", false);
  streamRegistry.subscribe(stream.id, sessionId, "r", "async", false);

  // Ensure the session has an async listener registered so messages
  // published to stdin are delivered to PowerLine.
  ensureAsyncDeliveryListener(sessionId);
}

/**
 * Publish a message to a session's stdin stream.
 *
 * @throws If the stdin stream does not exist for the given session.
 */
export function publishToStdin(sessionId: string, text: string): void {
  const name = `${STDIN_PREFIX}${sessionId}`;
  const stream = streamRegistry.getStreamByName(name);
  if (!stream) {
    throw new Error(`No stdin stream for session ${sessionId}`);
  }

  streamRegistry.publish(stream.id, SERVER_SESSION_ID, text);
}
