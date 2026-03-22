/**
 * Lifecycle manager — auto-hibernates sessions when all their file descriptors are closed.
 *
 * When the last subscription (fd) for a session is removed from the stream-registry,
 * the orphan callback fires and this module:
 * 1. Sets the session status to HIBERNATING
 * 2. Kills the PowerLine process (best-effort)
 * 3. Broadcasts the status change to UI clients
 * 4. Emits a task.updated event if the session has a task
 *
 * This is the foundation of the emergent lifecycle model: session alive/dead is
 * determined by subscription state, not explicit status calls.
 */

import { create } from "@bufbuild/protobuf";
import { grackle, SESSION_STATUS, TERMINAL_SESSION_STATUSES } from "@grackle-ai/common";
import type { SessionStatus } from "@grackle-ai/common";
import { powerline } from "@grackle-ai/common";
import * as streamRegistry from "./stream-registry.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import * as streamHub from "./stream-hub.js";
import * as taskStore from "./task-store.js";
import { emit } from "./event-bus.js";
import { logger } from "./logger.js";

/** Whether the lifecycle manager has been initialized. */
let initialized: boolean = false;

/**
 * Initialize the lifecycle manager. Registers the orphan callback on the
 * stream-registry so that sessions auto-hibernate when all fds are closed.
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

    // Don't hibernate if already in a terminal state
    if (TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
      return;
    }

    logger.info({ sessionId, previousStatus: session.status }, "Session orphaned (no remaining fds) — hibernating");

    sessionStore.hibernateSession(sessionId);

    // Kill the PowerLine process (best-effort — may have already exited)
    const conn = adapterManager.getConnection(session.environmentId);
    if (conn) {
      conn.client.kill(
        create(powerline.SessionIdSchema, { id: sessionId }),
      ).catch(() => {
        // Best-effort — process may have already exited
      });
    }

    // Broadcast status change to UI clients
    streamHub.publish(
      create(grackle.SessionEventSchema, {
        sessionId,
        type: grackle.EventType.STATUS,
        timestamp: new Date().toISOString(),
        content: SESSION_STATUS.HIBERNATING,
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
 * Reset module state. For testing only.
 * @internal
 */
export function _resetForTesting(): void {
  initialized = false;
}
