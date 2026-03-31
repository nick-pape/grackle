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
import { powerline } from "@grackle-ai/common";
import { sessionStore } from "@grackle-ai/database";
import * as adapterManager from "./adapter-manager.js";
import * as streamRegistry from "./stream-registry.js";
import { readLastTextEntry } from "./log-writer.js";
import { logger } from "./logger.js";

/** Maximum length for the child's last text message in pipe delivery. */
const MAX_LAST_MESSAGE_LENGTH: number = 4000;

/** Human-readable status labels keyed by runtime event content strings. */
const STATUS_LABELS: Record<string, string> = {
  completed: "completed",
  killed: "was killed",
  failed: "failed",
  waiting_input: "finished (idle)",
};

/** Stored unsubscribe functions for async listeners, keyed by parent session ID. */
const asyncListenerCleanups: Map<string, () => void> = new Map();

/**
 * Register an async delivery listener for a session. When messages arrive on any
 * async subscription for this session, the listener calls sendInput to inject them.
 *
 * Idempotent — safe to call multiple times for the same session.
 *
 * The listener throws if pre-dispatch checks fail (session not found, environment
 * disconnected), which causes the stream-registry to leave the message as undelivered.
 * The listener returns the sendInput Promise so the stream-registry can track delivery
 * end-to-end: the message is only marked delivered when the gRPC call resolves.
 */
export function ensureAsyncDeliveryListener(sessionId: string): void {
  if (asyncListenerCleanups.has(sessionId)) {
    return;
  }

  const unsubscribe = streamRegistry.registerAsyncListener(sessionId, (sub, msg) => {
    const session = sessionStore.getSession(sessionId);
    if (!session) {
      throw new Error(`Async pipe delivery: session ${sessionId} not found`);
    }

    const conn = adapterManager.getConnection(session.environmentId);
    if (!conn) {
      throw new Error(`Async pipe delivery: environment ${session.environmentId} not connected`);
    }

    // stdin streams deliver plain text; pipe/global streams prefix with [fd:N]
    const stream = streamRegistry.getStream(sub.streamId);
    const isStdin = stream?.name.startsWith("stdin:");
    const text = isStdin ? msg.content : `[fd:${sub.fd}] ${msg.content}`;
    return conn.client.sendInput(
      create(powerline.InputMessageSchema, { sessionId, text }),
    ).then(() => {}).catch((err: unknown) => {
      logger.warn({ err, sessionId }, "Async pipe delivery: sendInput failed — message left undelivered");
      throw err;
    });
  });

  asyncListenerCleanups.set(sessionId, unsubscribe);
}

/** @deprecated Use ensureAsyncDeliveryListener instead. */
export function setupAsyncPipeDelivery(parentSessionId: string): void {
  ensureAsyncDeliveryListener(parentSessionId);
}

/**
 * Publish a completion message to the IPC stream when a child session with a pipe
 * reaches terminal status (or idle for sync pipes). Called from the event processor.
 *
 * For sync pipes: also triggers on `waiting_input` (idle) to unblock the parent's
 * `consumeSync()` when a child goes idle without calling `task_complete`.
 * For async pipes: `waiting_input` is ignored — the child can still accept input.
 *
 * For async pipes: cleans up the stream and listener immediately after publish.
 * For sync pipes: does NOT clean up — the WaitForPipe consumer handles cleanup
 * after it reads the message (avoids race where cleanup runs before consumer reads).
 */
export async function publishChildCompletion(childSessionId: string, status: string): Promise<void> {
  const session = sessionStore.getSession(childSessionId);
  if (!session) {
    return;
  }

  // Only publish for sessions that have a parent and a non-detach pipe
  if (!session.parentSessionId || !session.pipeMode || session.pipeMode === "detach") {
    return;
  }

  // For non-sync pipes, idle is not a completion signal — the child can still accept input.
  // Only sync pipes treat waiting_input as delivery-worthy (unblocks parent's consumeSync).
  if (status === "waiting_input" && session.pipeMode !== "sync") {
    return;
  }

  // Find the pipe stream by name convention
  const pipeStream = streamRegistry.getStreamByName(`pipe:${childSessionId}`);
  if (!pipeStream) {
    return;
  }

  // Build rich completion message with child's actual output
  const message = buildCompletionMessage(session, status);

  let msg: ReturnType<typeof streamRegistry.publish> | undefined;
  try {
    msg = streamRegistry.publish(pipeStream.id, childSessionId, message);
  } catch (err) {
    logger.warn({ err, childSessionId }, "Failed to publish child completion to IPC stream");
    return;
  }

  // Await pending async deliveries (e.g. gRPC sendInput Promises) so that
  // hasUndeliveredMessages reflects the true post-gRPC delivery state.
  await streamRegistry.awaitPendingDeliveries(msg);

  // For async pipes, only clean up if all messages were successfully delivered.
  // If delivery failed (listener threw or gRPC rejected), keep the stream so
  // hasUndeliveredMessages stays accurate for close() buffer drain checks.
  // For sync pipes, the WaitForPipe handler cleans up after consumeSync returns.
  if (session.pipeMode === "async") {
    // Check all parent subscriptions — if any have undelivered messages, keep the stream
    const parentSubs = streamRegistry.getSubscriptionsForSession(session.parentSessionId)
      .filter((s) => s.streamId === pipeStream.id);
    const allDelivered = parentSubs.every((s) => !streamRegistry.hasUndeliveredMessages(s.id));
    if (allDelivered) {
      cleanupAsyncPipe(pipeStream.id, session.parentSessionId);
    }
  }
}

/** Clean up an async pipe stream and its listener (only if no remaining async subs for parent). */
function cleanupAsyncPipe(streamId: string, parentSessionId: string): void {
  // Collect all session IDs on this stream before deleting (for listener cleanup)
  const stream = streamRegistry.getStream(streamId);
  const sessionIds: string[] = [];
  if (stream) {
    for (const sub of stream.subscriptions.values()) {
      sessionIds.push(sub.sessionId);
    }
  }

  // Delete the stream (which unsubscribes everyone)
  streamRegistry.deleteStream(streamId);

  // Clean up async listeners for all sessions that were on this stream
  // (both parent and child). Only removes if no remaining async subscriptions.
  for (const sid of sessionIds) {
    cleanupAsyncListenerIfEmpty(sid);
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
 * Uses tail-reading to reduce worst-case work on large logs (reads from
 * the end of the file rather than parsing the entire JSONL). Still uses
 * synchronous filesystem calls.
 * Returns an empty string if no text entries exist or the log cannot be read.
 */
function extractLastTextMessage(logPath: string | undefined): string {
  if (!logPath) {
    return "";
  }

  try {
    return readLastTextEntry(logPath)?.content ?? "";
  } catch {
    return "";
  }
}

/**
 * Remove the async listener for a session if it has no remaining async subscriptions.
 * Called from closeFd when closing a pipe fd.
 */
export function cleanupAsyncListenerIfEmpty(sessionId: string): void {
  const remainingAsyncSubs = streamRegistry.getSubscriptionsForSession(sessionId)
    .filter((s) => s.deliveryMode === "async");
  if (remainingAsyncSubs.length === 0) {
    const cleanup = asyncListenerCleanups.get(sessionId);
    if (cleanup) {
      cleanup();
      asyncListenerCleanups.delete(sessionId);
    }
  }
}

/**
 * Clean up both the pipe stream and its associated lifecycle stream after
 * a sync pipe has been consumed (or cancelled). Called from the `waitForPipe`
 * handler's `finally` block, so it runs on both success and failure
 * (e.g., when `consumeSync()` is rejected due to cancellation or stream deletion).
 *
 * Deleting the lifecycle stream orphans the child session (no remaining
 * subscriptions), which triggers auto-stop via the lifecycle manager.
 * This prevents idle children from lingering after sync pipe delivery.
 */
export function cleanupSyncPipeAndLifecycle(
  pipeStreamId: string,
  childSessionId?: string,
): void {
  const stream = streamRegistry.getStream(pipeStreamId);

  // Prefer explicitly provided childSessionId; fall back to extracting from
  // the stream name convention: "pipe:{childSessionId}".
  let effectiveChildSessionId = childSessionId;
  if (!effectiveChildSessionId && stream?.name.startsWith("pipe:")) {
    effectiveChildSessionId = stream.name.slice("pipe:".length);
  }

  // Delete the pipe stream if it still exists (may already be gone if a
  // concurrent fd close removed it while consumeSync was blocked).
  if (stream) {
    streamRegistry.deleteStream(pipeStreamId);
  }

  // Auto-close the lifecycle stream so the child gets orphaned and stopped.
  // This still runs even if the pipe stream was already deleted, as long as
  // a childSessionId was provided by the caller.
  if (effectiveChildSessionId) {
    const lifecycleStream = streamRegistry.getStreamByName(`lifecycle:${effectiveChildSessionId}`);
    if (lifecycleStream) {
      streamRegistry.deleteStream(lifecycleStream.id);
    }
    // Also clean up stdin stream to prevent it from keeping the session alive
    const stdinStream = streamRegistry.getStreamByName(`stdin:${effectiveChildSessionId}`);
    if (stdinStream) {
      streamRegistry.deleteStream(stdinStream.id);
    }
  }
}

/** Clear all state. For testing only. */
export function _resetForTesting(): void {
  for (const cleanup of asyncListenerCleanups.values()) {
    cleanup();
  }
  asyncListenerCleanups.clear();
}
