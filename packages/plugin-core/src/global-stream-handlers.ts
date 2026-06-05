/**
 * Global (agent-driven) stream handlers: createStream, attachStream, listStreams.
 * Extracted from session-handlers.ts (#1470).
 *
 * @module
 */

import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import { streamRegistry, pipeDelivery, RESERVED_PREFIXES } from "@grackle-ai/core";
import { requireField } from "./require-helpers.js";

/** Valid permission values for stream subscriptions. */
const VALID_PERMISSIONS: ReadonlySet<string> = new Set(["r", "w", "rw"]);

/** Valid delivery mode values for stream subscriptions. */
const VALID_DELIVERY_MODES: ReadonlySet<string> = new Set(["sync", "async", "detach"]);

/** Check if a requested permission is a subset of the caller's permission. */
function isPermissionSubset(requested: string, callerHas: string): boolean {
  if (callerHas === "rw") {
    return true;
  }
  return requested === callerHas;
}

/** Validate permission and deliveryMode, enforcing the w-only → detach rule. */
export function validateSubscriptionParams(permission: string, deliveryMode: string): void {
  if (!VALID_PERMISSIONS.has(permission)) {
    throw new ConnectError(
      `Invalid permission "${permission}" — must be "r", "w", or "rw"`,
      Code.InvalidArgument,
    );
  }
  if (!VALID_DELIVERY_MODES.has(deliveryMode)) {
    throw new ConnectError(
      `Invalid delivery_mode "${deliveryMode}" — must be "sync", "async", or "detach"`,
      Code.InvalidArgument,
    );
  }
  if (permission === "w" && deliveryMode !== "detach") {
    throw new ConnectError(
      `Write-only permission requires delivery_mode "detach" (got "${deliveryMode}")`,
      Code.InvalidArgument,
    );
  }
}

/** Create a new named stream. Creator gets an rw/async subscription. */
export async function createStream(
  req: grackle.CreateStreamRequest,
): Promise<grackle.CreateStreamResponse> {
  requireField(req.sessionId, "session_id");
  requireField(req.name, "name");
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

  const sub = streamRegistry.subscribe(stream.id, req.sessionId, "rw", "async", false);
  pipeDelivery.ensureAsyncDeliveryListener(req.sessionId);

  return create(grackle.CreateStreamResponseSchema, {
    streamId: stream.id,
    fd: sub.fd,
  });
}

/** Attach another session to a stream the caller holds an fd on. */
export async function attachStream(
  req: grackle.AttachStreamRequest,
): Promise<grackle.AttachStreamResponse> {
  requireField(req.sessionId, "session_id");
  requireField(req.targetSessionId, "target_session_id");

  const callerSub = streamRegistry.getSubscription(req.sessionId, req.fd);
  if (!callerSub) {
    throw new ConnectError(
      `No subscription found for session ${req.sessionId} fd ${String(req.fd)}`,
      Code.NotFound,
    );
  }

  const permission = req.permission || "rw";
  const deliveryMode = req.deliveryMode || "async";

  validateSubscriptionParams(permission, deliveryMode);

  if (!isPermissionSubset(permission, callerSub.permission)) {
    throw new ConnectError(
      `Cannot grant "${permission}" — caller only has "${callerSub.permission}"`,
      Code.PermissionDenied,
    );
  }

  const targetSub = streamRegistry.subscribe(
    callerSub.streamId,
    req.targetSessionId,
    permission as "r" | "w" | "rw",
    deliveryMode as "sync" | "async" | "detach",
    false,
  );

  if (deliveryMode === "async") {
    pipeDelivery.ensureAsyncDeliveryListener(req.targetSessionId);
  }

  return create(grackle.AttachStreamResponseSchema, {
    fd: targetSub.fd,
  });
}

/**
 * List active IPC streams with subscriber details and message buffer depth.
 *
 * By default, internal IPC plumbing streams (reserved `lifecycle:` / `pipe:` /
 * `stdin:` prefixes) are filtered out — they are infrastructure, not user-facing
 * coordination. Set `include_internal` to surface them for debugging.
 */
export async function listStreams(
  req: grackle.ListStreamsRequest,
): Promise<grackle.ListStreamsResponse> {
  const allStreams = streamRegistry.listStreams();
  const visibleStreams = req.includeInternal
    ? allStreams
    : allStreams.filter(
        (stream) => !RESERVED_PREFIXES.some((prefix) => stream.name.startsWith(prefix)),
      );
  return create(grackle.ListStreamsResponseSchema, {
    streams: visibleStreams.map((stream) => {
      const subscribers = Array.from(stream.subscriptions.values()).map((sub) =>
        create(grackle.StreamSubscriberInfoSchema, {
          subscriptionId: sub.id,
          sessionId: sub.sessionId,
          fd: sub.fd,
          permission: sub.permission,
          deliveryMode: sub.deliveryMode,
          createdBySpawn: sub.createdBySpawn,
        }),
      );
      return create(grackle.StreamInfoSchema, {
        id: stream.id,
        name: stream.name,
        subscriberCount: stream.subscriptions.size,
        messageBufferDepth: stream.messages.length,
        subscribers,
        selfEcho: stream.selfEcho,
      });
    }),
  });
}
