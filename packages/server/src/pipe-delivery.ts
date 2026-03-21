/**
 * Pipe delivery — wires IPC streams to session sendInput for parent↔child communication.
 *
 * - `setupAsyncPipeDelivery()`: registers an async listener that calls sendInput on the
 *   parent session when a child publishes a message to the pipe stream.
 * - `publishChildCompletion()`: called from the event processor when a child session with
 *   a pipe reaches terminal status, publishing the result to the IPC stream.
 *   For async pipes, cleans up after publish. For sync pipes, cleanup is handled
 *   by the WaitForPipe consumer after it reads the message.
 */

import { create } from "@bufbuild/protobuf";
import { powerline, SESSION_STATUS } from "@grackle-ai/common";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import * as streamRegistry from "./stream-registry.js";
import type { Subscription } from "./stream-registry.js";
import { readLog } from "./log-writer.js";
import { logger } from "./logger.js";

/** Maximum length for the child's last text message in pipe delivery. */
const MAX_LAST_MESSAGE_LENGTH: number = 4000;

/** Human-readable status labels. */
const STATUS_LABELS: Record<string, string> = {
  [SESSION_STATUS.IDLE]: "finished working",
  [SESSION_STATUS.COMPLETED]: "completed",
  [SESSION_STATUS.FAILED]: "failed",
  [SESSION_STATUS.INTERRUPTED]: "was interrupted",
  [SESSION_STATUS.HIBERNATING]: "hibernated",
};

/** Stored unsubscribe functions for async listeners, keyed by parent session ID. */
const asyncListenerCleanups: Map<string, () => void> = new Map();

/**
 * Register an async listener that delivers IPC stream messages to a parent session
 * via sendInput. Called when a pipe with "async" mode is created.
 *
 * The listener throws if delivery fails (session not found, environment disconnected),
 * which causes the stream-registry to leave the message as undelivered. This ensures
 * `hasUndeliveredMessages()` remains accurate for close() buffer drain checks.
 */
export function setupAsyncPipeDelivery(parentSessionId: string, _parentSub: Subscription): void {
  const unsubscribe = streamRegistry.registerAsyncListener(parentSessionId, (sub, msg) => {
    const session = sessionStore.getSession(parentSessionId);
    if (!session) {
      throw new Error(`Async pipe delivery: parent session ${parentSessionId} not found`);
    }

    const conn = adapterManager.getConnection(session.environmentId);
    if (!conn) {
      throw new Error(`Async pipe delivery: environment ${session.environmentId} not connected`);
    }

    const text = `[fd:${sub.fd}] ${msg.content}`;
    // Fire sendInput — this is async but we've verified the connection exists.
    // If the gRPC call fails later, the message is already marked delivered.
    // This is an acceptable trade-off: the connection was live at check time.
    conn.client.sendInput(
      create(powerline.InputMessageSchema, { sessionId: parentSessionId, text }),
    ).catch((err: unknown) => {
      logger.warn({ err, parentSessionId }, "Async pipe delivery: sendInput failed after dispatch");
    });
  });

  asyncListenerCleanups.set(parentSessionId, unsubscribe);
}

/**
 * Publish a completion message to the IPC stream when a child session with a pipe
 * reaches terminal status. Called from the event processor.
 *
 * For async pipes: cleans up the stream and listener immediately after publish.
 * For sync pipes: does NOT clean up — the WaitForPipe consumer handles cleanup
 * after it reads the message (avoids race where cleanup runs before consumer reads).
 */
export function publishChildCompletion(childSessionId: string, status: string): void {
  const session = sessionStore.getSession(childSessionId);
  if (!session) {
    return;
  }

  // Only publish for sessions that have a parent and a non-detach pipe
  if (!session.parentSessionId || !session.pipeMode || session.pipeMode === "detach") {
    return;
  }

  // Find the pipe stream by name convention
  const pipeStream = streamRegistry.getStreamByName(`pipe:${childSessionId}`);
  if (!pipeStream) {
    return;
  }

  // Build rich completion message with child's actual output
  const message = buildCompletionMessage(session, status);

  try {
    streamRegistry.publish(pipeStream.id, childSessionId, message);
  } catch (err) {
    logger.warn({ err, childSessionId }, "Failed to publish child completion to IPC stream");
  }

  // For async pipes, clean up immediately (the listener already fired).
  // For sync pipes, the WaitForPipe handler will clean up after consumeSync returns.
  if (session.pipeMode === "async") {
    cleanupAsyncPipe(pipeStream.id, session.parentSessionId);
  }
}

/** Clean up an async pipe stream and its listener (only if no remaining async subs for parent). */
function cleanupAsyncPipe(streamId: string, parentSessionId: string): void {
  // Delete the stream (which unsubscribes everyone)
  streamRegistry.deleteStream(streamId);

  // Only remove the async listener if the parent has no remaining async subscriptions.
  // A parent with multiple concurrent async children should keep the listener alive.
  const remainingAsyncSubs = streamRegistry.getSubscriptionsForSession(parentSessionId)
    .filter((s) => s.deliveryMode === "async");
  if (remainingAsyncSubs.length === 0) {
    const cleanup = asyncListenerCleanups.get(parentSessionId);
    if (cleanup) {
      cleanup();
      asyncListenerCleanups.delete(parentSessionId);
    }
  }
}

/**
 * Build a rich completion message from the child session's log,
 * including the status and the child's last text output.
 */
// eslint-disable-next-line @rushstack/no-new-null -- matches DB schema types
function buildCompletionMessage(session: { logPath: string | null; error: string | null }, status: string): string {
  const statusLabel = STATUS_LABELS[status] || status;
  let message = `Child session ${statusLabel}.`;

  // Extract the last text message from the child's session log
  const lastText = extractLastTextMessage(session.logPath || undefined);
  if (lastText) {
    const truncated = lastText.length > MAX_LAST_MESSAGE_LENGTH
      ? lastText.slice(0, MAX_LAST_MESSAGE_LENGTH) + "..."
      : lastText;
    message += `\n\nChild's last message:\n${truncated}`;
  }

  if (session.error) {
    message += `\n\nError: ${session.error}`;
  }

  return message;
}

/**
 * Read the session log and extract the content of the last "text" entry.
 * Returns an empty string if no text entries exist or the log cannot be read.
 */
function extractLastTextMessage(logPath: string | undefined): string {
  if (!logPath) {
    return "";
  }

  try {
    const entries = readLog(logPath);
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === "text") {
        return entries[i].content;
      }
    }
    return "";
  } catch {
    return "";
  }
}

/** Clear all state. For testing only. */
export function _resetForTesting(): void {
  for (const cleanup of asyncListenerCleanups.values()) {
    cleanup();
  }
  asyncListenerCleanups.clear();
}
