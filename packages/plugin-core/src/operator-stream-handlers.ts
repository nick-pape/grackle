/**
 * Operator stream control plane (#1309): operatorCreateStream, operatorAttachTask,
 * operatorDetachTask, listTaskAttachments, operatorCloseStream.
 * Extracted from session-handlers.ts (#1470).
 *
 * @module
 */

import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { sessionStore, taskStore } from "@grackle-ai/database";
import {
  streamRegistry,
  pipeDelivery,
  RESERVED_PREFIXES,
  OPERATOR_PRINCIPAL,
  isOperatorPrincipal,
  isReservedStreamName,
  getLatestLiveSessionId,
} from "@grackle-ai/core";
import { validateSubscriptionParams } from "./global-stream-handlers.js";

/**
 * Resolve a task's latest live (pending/running/idle) session, or throw if the
 * task is unknown. Shared by the operator attach/detach/list handlers.
 */
function resolveLiveSessionForTask(taskId: string): string {
  const task = taskStore.getTask(taskId);
  if (!task) {
    throw new ConnectError(`Task not found: ${taskId}`, Code.NotFound);
  }
  return getLatestLiveSessionId(sessionStore.listSessionsForTask(taskId));
}

/**
 * True if `stream` is an operator-owned room — i.e. it carries an `operator:*`
 * anchor subscription. The operator control plane only manages rooms it created;
 * it must not attach/detach/close agent-owned streams.
 */
function isOperatorRoom(stream: streamRegistry.Stream): boolean {
  for (const sub of stream.subscriptions.values()) {
    if (isOperatorPrincipal(sub.sessionId)) {
      return true;
    }
  }
  return false;
}

/**
 * Create an operator-owned room. Unlike {@link createStream} (agent-driven, needs
 * a creator session), this is human-driven via the server: it plants the
 * `operator:*` anchor (`rw`/`detach`) so the room survives at zero agents and
 * appears in the roster. Reserved-prefix and duplicate names are rejected.
 */
export async function operatorCreateStream(
  req: grackle.OperatorCreateStreamRequest,
): Promise<grackle.OperatorCreateStreamResponse> {
  if (!req.name) {
    throw new ConnectError("name is required", Code.InvalidArgument);
  }
  if (RESERVED_PREFIXES.some((prefix) => req.name.startsWith(prefix))) {
    throw new ConnectError(
      `Stream name "${req.name}" uses a reserved prefix`,
      Code.InvalidArgument,
    );
  }

  let stream;
  try {
    stream = streamRegistry.createStream(req.name, req.selfEcho);
  } catch {
    throw new ConnectError(`Stream name "${req.name}" already exists`, Code.AlreadyExists);
  }

  // Anchor the room with the operator principal: `rw` so a later OperatorPublish
  // (T5) can write, `detach` so the server-side principal holds the room open and
  // shows in the roster without being async-pushed messages.
  streamRegistry.subscribe(stream.id, OPERATOR_PRINCIPAL, "rw", "detach", false);

  return create(grackle.OperatorCreateStreamResponseSchema, { streamId: stream.id });
}

/**
 * Attach a task's latest live session to a stream (operator-driven). The
 * attachment is ephemeral in T1 — it lives with the resolved session; durable,
 * re-applied task-keyed intent lands in T2 (#1310). Fails with FailedPrecondition
 * when the task has no live session to attach.
 */
export async function operatorAttachTask(
  req: grackle.OperatorAttachTaskRequest,
): Promise<grackle.OperatorAttachTaskResponse> {
  if (!req.taskId) {
    throw new ConnectError("task_id is required", Code.InvalidArgument);
  }
  if (!req.streamId) {
    throw new ConnectError("stream_id is required", Code.InvalidArgument);
  }

  const stream = streamRegistry.getStream(req.streamId);
  if (!stream) {
    throw new ConnectError(`Stream not found: ${req.streamId}`, Code.NotFound);
  }
  if (!isOperatorRoom(stream)) {
    throw new ConnectError(
      `Stream ${req.streamId} is not an operator-owned room`,
      Code.FailedPrecondition,
    );
  }

  // The operator principal holds `rw`, so any requested grant ("r"/"w"/"rw") is
  // trivially a subset; we only validate the permission/delivery values here.
  const permission = req.permission || "rw";
  const deliveryMode = req.deliveryMode || "async";
  validateSubscriptionParams(permission, deliveryMode);

  const sessionId = resolveLiveSessionForTask(req.taskId);
  if (!sessionId) {
    throw new ConnectError(
      `Task ${req.taskId} has no live session to attach (durable attach lands in T2)`,
      Code.FailedPrecondition,
    );
  }

  const sub = streamRegistry.subscribe(
    req.streamId,
    sessionId,
    permission as "r" | "w" | "rw",
    deliveryMode as "sync" | "async" | "detach",
    false,
  );

  if (deliveryMode === "async") {
    pipeDelivery.ensureAsyncDeliveryListener(sessionId);
  }

  return create(grackle.OperatorAttachTaskResponseSchema, { sessionId, fd: sub.fd });
}

/**
 * Detach a task's latest live session from a stream (operator-driven). The
 * operator anchor keeps the room alive after the agent leaves. Only operates on
 * operator-owned rooms. Idempotent: returns `detached=false` when the room is
 * already gone, the task has no live session, or it has no matching subscription
 * on the stream.
 */
export async function operatorDetachTask(
  req: grackle.OperatorDetachTaskRequest,
): Promise<grackle.OperatorDetachTaskResponse> {
  if (!req.taskId) {
    throw new ConnectError("task_id is required", Code.InvalidArgument);
  }
  if (!req.streamId) {
    throw new ConnectError("stream_id is required", Code.InvalidArgument);
  }

  const stream = streamRegistry.getStream(req.streamId);
  if (!stream) {
    // Room already gone — nothing to detach.
    return create(grackle.OperatorDetachTaskResponseSchema, { detached: false });
  }
  if (!isOperatorRoom(stream)) {
    throw new ConnectError(
      `Stream ${req.streamId} is not an operator-owned room`,
      Code.FailedPrecondition,
    );
  }

  const sessionId = resolveLiveSessionForTask(req.taskId);
  if (!sessionId) {
    return create(grackle.OperatorDetachTaskResponseSchema, { detached: false });
  }

  const sub = streamRegistry
    .getSubscriptionsForSession(sessionId)
    .find((s) => s.streamId === req.streamId);
  if (!sub) {
    return create(grackle.OperatorDetachTaskResponseSchema, { detached: false });
  }

  streamRegistry.unsubscribe(sub.id);
  pipeDelivery.cleanupAsyncListenerIfEmpty(sessionId);

  return create(grackle.OperatorDetachTaskResponseSchema, { detached: true });
}

/**
 * List the rooms a task's latest live session is attached to (operator-driven).
 * Reserved plumbing streams are excluded. In T1 this reflects the live session's
 * current subscriptions; durable task-keyed intent (including not-yet-started
 * tasks) lands in T2 (#1310).
 */
export async function listTaskAttachments(
  req: grackle.ListTaskAttachmentsRequest,
): Promise<grackle.ListTaskAttachmentsResponse> {
  if (!req.taskId) {
    throw new ConnectError("task_id is required", Code.InvalidArgument);
  }

  const sessionId = resolveLiveSessionForTask(req.taskId);
  if (!sessionId) {
    return create(grackle.ListTaskAttachmentsResponseSchema, { attachments: [] });
  }

  const attachments = streamRegistry
    .getSubscriptionsForSession(sessionId)
    .map((sub) => ({ sub, stream: streamRegistry.getStream(sub.streamId) }))
    .filter((entry) => entry.stream && !isReservedStreamName(entry.stream.name))
    .map((entry) =>
      create(grackle.TaskAttachmentSchema, {
        streamId: entry.sub.streamId,
        streamName: entry.stream!.name,
        sessionId,
        permission: entry.sub.permission,
        deliveryMode: entry.sub.deliveryMode,
      }),
    );

  return create(grackle.ListTaskAttachmentsResponseSchema, { attachments });
}

/**
 * Close an operator room — evict all subscribers (including the operator anchor)
 * and remove the stream. Only operator-owned rooms can be closed: reserved
 * plumbing streams and agent-owned rooms (no `operator:*` anchor) are rejected.
 */
export async function operatorCloseStream(
  req: grackle.OperatorCloseStreamRequest,
): Promise<grackle.OperatorCloseStreamResponse> {
  if (!req.streamId) {
    throw new ConnectError("stream_id is required", Code.InvalidArgument);
  }

  const stream = streamRegistry.getStream(req.streamId);
  if (!stream) {
    throw new ConnectError(`Stream not found: ${req.streamId}`, Code.NotFound);
  }
  if (isReservedStreamName(stream.name)) {
    throw new ConnectError(
      `Stream "${stream.name}" is an internal plumbing stream and cannot be closed`,
      Code.InvalidArgument,
    );
  }
  if (!isOperatorRoom(stream)) {
    throw new ConnectError(
      `Stream ${req.streamId} is not an operator-owned room`,
      Code.FailedPrecondition,
    );
  }

  // Snapshot the affected sessions before teardown so we can deregister their
  // async-delivery listeners afterward — deleteStream removes the subscriptions
  // but not the per-session listeners. Mirrors closeFd / operatorDetachTask;
  // skipping it leaks a listener when the room held a session's last async sub.
  const affectedSessionIds = new Set(
    Array.from(stream.subscriptions.values()).map((sub) => sub.sessionId),
  );

  streamRegistry.deleteStream(req.streamId);

  for (const sessionId of affectedSessionIds) {
    pipeDelivery.cleanupAsyncListenerIfEmpty(sessionId);
  }

  return create(grackle.OperatorCloseStreamResponseSchema, { closed: true });
}
