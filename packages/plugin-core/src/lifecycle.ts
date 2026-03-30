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
import {
  streamRegistry, adapterManager, streamHub, reanimateAgent, logger,
  cleanupLifecycleStream, ensureLifecycleStream,
} from "@grackle-ai/core";
import type { Disposable, PluginContext } from "@grackle-ai/core";

// Re-export lifecycle stream utilities so existing plugin-core consumers
// can continue to import from this module.
export { cleanupLifecycleStream, ensureLifecycleStream };

/**
 * Create the lifecycle manager subscriber.
 *
 * Registers orphan and revival callbacks on the stream-registry so that
 * sessions auto-stop when all fds are closed and auto-reanimate when
 * a new fd is opened.
 *
 * @param ctx - Plugin context providing event-bus access.
 * @returns A Disposable that unregisters both callbacks.
 */
export function createLifecycleSubscriber(ctx: PluginContext): Disposable {
  const unsubOrphan = streamRegistry.onSessionOrphaned((sessionId: string) => {
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
        ctx.emit("task.updated", { taskId: task.id, workspaceId: task.workspaceId || "" });
      }
    }
  });

  // ── Auto-reanimate: when an external session subscribes to a lifecycle
  // stream whose session is stopped, automatically restart it. This is the
  // "open() IS reanimate" model from the streams IPC spec.
  const unsubRevived = streamRegistry.onSessionRevived((targetSessionId: string, _subscriberSessionId: string) => {
    const session = sessionStore.getSession(targetSessionId);
    if (!session) {
      return;
    }

    // Only reanimate stopped or suspended sessions
    if (!TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus) && session.status !== SESSION_STATUS.SUSPENDED) {
      return;
    }

    // Must have a runtimeSessionId to resume from JSONL
    if (!session.runtimeSessionId) {
      logger.debug({ targetSessionId }, "Auto-reanimate skipped: no runtimeSessionId");
      return;
    }

    // Environment must not have another active session
    const existingActive = sessionStore.getActiveForEnv(session.environmentId);
    if (existingActive) {
      logger.debug({ targetSessionId, existingActive: existingActive.id }, "Auto-reanimate skipped: environment busy");
      return;
    }

    // Environment must be connected
    const conn = adapterManager.getConnection(session.environmentId);
    if (!conn) {
      logger.debug({ targetSessionId }, "Auto-reanimate skipped: environment disconnected");
      return;
    }

    logger.info({ targetSessionId }, "Auto-reanimating session on new lifecycle subscription");
    try {
      reanimateAgent(targetSessionId);
    } catch (err) {
      logger.debug({ err, targetSessionId }, "Auto-reanimate failed (non-fatal)");
    }
  });

  logger.info("Lifecycle manager initialized");

  return {
    dispose(): void {
      unsubOrphan();
      unsubRevived();
    },
  };
}

