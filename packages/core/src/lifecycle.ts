/**
 * Lifecycle manager — auto-stops sessions when all their file descriptors are closed.
 *
 * When the last subscription (fd) for a session is removed from the stream-registry,
 * the orphan callback fires and this module:
 * 1. Sets the session status to STOPPED with an appropriate end reason
 * 2. Kills the PowerLine process (best-effort)
 * 3. Broadcasts the end reason to UI clients
 * 4. Emits a task.updated event if the session has a task
 *
 * This is the foundation of the emergent lifecycle model: session alive/dead is
 * determined by subscription state, not explicit status calls.
 */

import { create } from "@bufbuild/protobuf";
import { grackle, SESSION_STATUS, TERMINAL_SESSION_STATUSES, END_REASON, powerline } from "@grackle-ai/common";
import type { SessionStatus, EndReason } from "@grackle-ai/common";
import { sessionStore, taskStore } from "@grackle-ai/database";
import * as streamRegistry from "./stream-registry.js";
import * as adapterManager from "./adapter-manager.js";
import * as streamHub from "./stream-hub.js";
import { emit } from "./event-bus.js";
import { logger } from "./logger.js";

/** Whether the lifecycle manager has been initialized. */
let initialized: boolean = false;

/**
 * Initialize the lifecycle manager. Registers the orphan callback on the
 * stream-registry so that sessions auto-stop when all fds are closed.
 * Idempotent — safe to call multiple times.
 */
export function initLifecycleManager(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  streamRegistry.onSessionOrphaned((sessionId: string) => {
    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return;
    }

    const alreadyTerminal = TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus);

    // Always kill the PowerLine process (best-effort — may have already exited).
    // Even if the session is already STOPPED (e.g. killAgent pre-set it), the
    // process may still be running and needs to be terminated.
    const conn = adapterManager.getConnection(session.environmentId);
    if (conn) {
      // Use the session's endReason if already set (killAgent pre-set it),
      // otherwise determine from the session's status at time of orphaning.
      let reason: EndReason;
      if (alreadyTerminal && session.endReason) {
        reason = session.endReason as EndReason;
      } else if (!alreadyTerminal && session.status === SESSION_STATUS.IDLE) {
        reason = session.sigtermSentAt ? END_REASON.TERMINATED : END_REASON.COMPLETED;
      } else {
        reason = END_REASON.KILLED;
      }
      conn.client.kill(
        create(powerline.KillRequestSchema, { id: sessionId, reason }),
      ).catch((err: unknown) => {
        logger.debug({ err, sessionId }, "Lifecycle: PowerLine kill failed (process may have already exited)");
      });
    }

    // Skip status change and broadcast if already terminal (killAgent already handled it)
    if (alreadyTerminal) {
      return;
    }

    // Determine reason: IDLE sessions completed naturally; others were killed.
    // If SIGTERM was sent and the session reached IDLE before being orphaned,
    // use TERMINATED instead of COMPLETED to distinguish graceful shutdowns.
    const reason: EndReason = session.status === SESSION_STATUS.IDLE
      ? (session.sigtermSentAt ? END_REASON.TERMINATED : END_REASON.COMPLETED)
      : END_REASON.KILLED;

    logger.info({ sessionId, previousStatus: session.status, reason }, "Session orphaned (no remaining fds) — stopping");

    sessionStore.updateSession(sessionId, SESSION_STATUS.STOPPED, undefined, undefined, reason);

    // Broadcast end reason to UI clients
    streamHub.publish(
      create(grackle.SessionEventSchema, {
        sessionId,
        type: grackle.EventType.STATUS,
        timestamp: new Date().toISOString(),
        content: reason,
        raw: "",
      }),
    );

    // Notify task system if this session belongs to a task
    if (session.taskId) {
      const task = taskStore.getTask(session.taskId);
      if (task) {
        emit("task.updated", { taskId: task.id, workspaceId: task.workspaceId || "" });
      }
    }
  });

  logger.info("Lifecycle manager initialized");
}

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

/**
 * Reset module state. For testing only.
 * @internal
 */
export function _resetForTesting(): void {
  initialized = false;
}
