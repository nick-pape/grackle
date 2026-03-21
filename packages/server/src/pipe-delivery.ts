/**
 * Pipe delivery — wires IPC streams to session sendInput for parent↔child communication.
 *
 * - `setupAsyncPipeDelivery()`: registers an async listener that calls sendInput on the
 *   parent session when a child publishes a message to the pipe stream.
 * - `publishChildCompletion()`: called from the event processor when a child session with
 *   a pipe reaches terminal status, publishing the result to the IPC stream.
 */

import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import * as streamRegistry from "./stream-registry.js";
import type { Subscription } from "./stream-registry.js";
import { logger } from "./logger.js";

/**
 * Register an async listener that delivers IPC stream messages to a parent session
 * via sendInput. Called when a pipe with "async" mode is created.
 */
export function setupAsyncPipeDelivery(parentSessionId: string, _parentSub: Subscription): void {
  streamRegistry.registerAsyncListener(parentSessionId, (sub, msg) => {
    const session = sessionStore.getSession(parentSessionId);
    if (!session) {
      logger.warn({ parentSessionId }, "Async pipe delivery: parent session not found");
      return;
    }

    const conn = adapterManager.getConnection(session.environmentId);
    if (!conn) {
      logger.warn({ parentSessionId, environmentId: session.environmentId }, "Async pipe delivery: environment not connected");
      return;
    }

    const text = `[fd:${sub.fd}] ${msg.content}`;
    conn.client.sendInput(
      create(powerline.InputMessageSchema, { sessionId: parentSessionId, text }),
    ).catch((err: unknown) => {
      logger.warn({ err, parentSessionId }, "Async pipe delivery: sendInput failed");
    });
  });
}

/**
 * Publish a completion message to the IPC stream when a child session with a pipe
 * reaches terminal status. Called from the event processor.
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

  const childSubs = streamRegistry.getSubscriptionsForSession(childSessionId);
  if (childSubs.length === 0) {
    return;
  }

  const streamId = childSubs[0].streamId;
  try {
    streamRegistry.publish(streamId, childSessionId, `Child session ${status}`);
  } catch (err) {
    logger.warn({ err, childSessionId, streamId }, "Failed to publish child completion to IPC stream");
  }
}
