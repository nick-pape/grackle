/**
 * IPC pipe file descriptor handlers: waitForPipe, writeToFd, closeFd,
 * getSessionFds. Extracted from session-handlers.ts (#1470).
 *
 * @module
 */

import { create } from "@bufbuild/protobuf";
import { grackle, NotFoundError, PreconditionError } from "@grackle-ai/common";
import { SESSION_STATUS } from "@grackle-ai/common";
import { sessionStore } from "@grackle-ai/database";
import { streamRegistry, pipeDelivery } from "@grackle-ai/core";
import { isReservedStreamName } from "@grackle-ai/core";

/** Wait for a message on a synchronous pipe subscription. */
export async function waitForPipe(
  req: grackle.WaitForPipeRequest,
): Promise<grackle.WaitForPipeResponse> {
  const sub = streamRegistry.getSubscription(req.sessionId, req.fd);
  if (!sub) {
    throw new NotFoundError(`No subscription found for session ${req.sessionId} fd ${req.fd}`);
  }

  if (sub.deliveryMode !== "sync") {
    throw new PreconditionError(
      `Subscription fd ${req.fd} is not a sync subscription (mode: ${sub.deliveryMode})`,
    );
  }

  // Capture child session ID before blocking — the pipe stream may be
  // removed by a concurrent fd close while consumeSync is awaiting.
  const pipeStream = streamRegistry.getStream(sub.streamId);
  const childSessionId = pipeStream?.name.startsWith("pipe:")
    ? pipeStream.name.slice("pipe:".length)
    : undefined;

  // Use try/finally so the pipe stream (and lifecycle stream) are cleaned up
  // even if consumeSync rejects (e.g., the request is cancelled or times out)
  // to prevent unbounded memory growth. Lifecycle cleanup also orphans the child,
  // triggering auto-stop so it doesn't linger in waiting_input (#824).
  let msg: Awaited<ReturnType<typeof streamRegistry.consumeSync>>;
  try {
    msg = await streamRegistry.consumeSync(sub.id);
  } finally {
    pipeDelivery.cleanupSyncPipeAndLifecycle(sub.streamId, childSessionId);
  }

  return create(grackle.WaitForPipeResponseSchema, {
    content: msg.content,
    senderSessionId: msg.senderId,
  });
}

/** Write a message to a pipe fd. */
export async function writeToFd(req: grackle.WriteToFdRequest): Promise<grackle.Empty> {
  const sub = streamRegistry.getSubscription(req.sessionId, req.fd);
  if (!sub) {
    throw new NotFoundError(`No subscription found for session ${req.sessionId} fd ${req.fd}`);
  }
  if (sub.permission !== "w" && sub.permission !== "rw") {
    throw new PreconditionError(
      `Subscription fd ${req.fd} does not have write permission (permission: ${sub.permission})`,
    );
  }

  const stream = streamRegistry.getStream(sub.streamId);
  if (!stream) {
    throw new PreconditionError("Stream no longer exists");
  }

  // Publish to stream — delivery is handled by async listeners registered
  // at spawn time via ensureAsyncDeliveryListener. This is the same path
  // used by publishChildCompletion for child→parent delivery.
  const msg = streamRegistry.publish(sub.streamId, req.sessionId, req.message);

  // Await pending async deliveries (gRPC sendInput Promises) before checking
  // deliveredTo. Without this, a rejected gRPC call after dispatch would still
  // appear delivered because deliveredTo was populated synchronously.
  await streamRegistry.awaitPendingDeliveries(msg);

  // Verify delivery to async subscribers — check if the published message
  // was marked as delivered for each async target. Sync and detach subscribers
  // are excluded (sync waits for consumeSync, detach buffers silently).
  for (const targetSub of stream.subscriptions.values()) {
    if (targetSub.sessionId === req.sessionId) {
      continue;
    }
    if (targetSub.deliveryMode === "async" && !msg.deliveredTo.has(targetSub.id)) {
      throw new PreconditionError(
        "Message delivery failed — target environment may be disconnected",
      );
    }
  }

  return create(grackle.EmptySchema, {});
}

/** Close a pipe file descriptor, optionally stopping child sessions. */
export async function closeFd(req: grackle.CloseFdRequest): Promise<grackle.CloseFdResponse> {
  const sub = streamRegistry.getSubscription(req.sessionId, req.fd);
  if (!sub) {
    throw new NotFoundError(`No subscription found for session ${req.sessionId} fd ${req.fd}`);
  }
  if (streamRegistry.hasUndeliveredMessages(sub.id)) {
    throw new PreconditionError(
      `Cannot close fd ${req.fd}: undelivered messages pending. Process or consume them first.`,
    );
  }

  const streamId = sub.streamId;
  const stream = streamRegistry.getStream(streamId);

  // Only unsubscribe other participants for internal streams (pipe/lifecycle).
  // Global streams (user-created) only unsubscribe the caller — closing your
  // fd should not disconnect other participants from the shared stream.
  const isInternalStream = stream ? isReservedStreamName(stream.name) : false;

  const childSubs: Array<{ sessionId: string; subId: string }> = [];
  if (isInternalStream && stream) {
    for (const s of stream.subscriptions.values()) {
      if (s.sessionId !== req.sessionId) {
        childSubs.push({ sessionId: s.sessionId, subId: s.id });
      }
    }
  }

  // Unsubscribe the caller
  streamRegistry.unsubscribe(sub.id);

  // Also unsubscribe children on internal streams — when their last
  // subscription is removed, the lifecycle manager's orphan callback auto-stops them.
  let stopped = false;
  for (const child of childSubs) {
    streamRegistry.unsubscribe(child.subId);
    // Check if the child was orphaned (auto-stopped)
    const childSession = sessionStore.getSession(child.sessionId);
    if (childSession?.status === SESSION_STATUS.STOPPED) {
      stopped = true;
    }
  }

  // Clean up async listeners for caller and any unsubscribed children
  pipeDelivery.cleanupAsyncListenerIfEmpty(req.sessionId);
  for (const child of childSubs) {
    pipeDelivery.cleanupAsyncListenerIfEmpty(child.sessionId);
  }

  return create(grackle.CloseFdResponseSchema, { stopped });
}

/** Get all open file descriptors for a session. */
export function getSessionFds(req: grackle.SessionId): grackle.SessionFds {
  const subs = streamRegistry.getSubscriptionsForSession(req.id);
  const fds = subs.map((sub) => {
    const stream = streamRegistry.getStream(sub.streamId);
    let targetSessionId = "";
    if (stream) {
      for (const s of stream.subscriptions.values()) {
        if (s.sessionId !== req.id) {
          targetSessionId = s.sessionId;
          break;
        }
      }
    }
    return create(grackle.FdInfoSchema, {
      fd: sub.fd,
      streamName: stream?.name || "",
      permission: sub.permission,
      deliveryMode: sub.deliveryMode,
      owned: sub.createdBySpawn,
      targetSessionId,
    });
  });
  return create(grackle.SessionFdsSchema, { fds });
}
