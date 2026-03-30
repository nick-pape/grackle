/**
 * gRPC handler shared utilities.
 *
 * Utility functions (`toDialableHost`, `validatePipeInputs`, `resolveAncestorEnvironmentId`,
 * `VALID_PIPE_MODES`) are defined in `@grackle-ai/core` and re-exported here for
 * backward compatibility with existing plugin-core consumers.
 *
 * `killSessionAndCleanup` is plugin-core-specific (uses lifecycle streams, orphan
 * reparent, and stream cleanup).
 */

import { create } from "@bufbuild/protobuf";
import { grackle, powerline } from "@grackle-ai/common";
import {
  ROOT_TASK_ID,
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  type SessionStatus,
  END_REASON,
} from "@grackle-ai/common";
import { transferAllPipeSubscriptions } from "./signals/orphan-reparent.js";
import type { SessionRow } from "@grackle-ai/database";
import { sessionStore, taskStore } from "@grackle-ai/database";
import {
  adapterManager, streamHub, streamRegistry,
  cleanupLifecycleStream, logger, emit,
  toDialableHost, validatePipeInputs, resolveAncestorEnvironmentId, VALID_PIPE_MODES,
} from "@grackle-ai/core";

// Re-export shared utilities from core so existing consumers don't break.
export { toDialableHost, validatePipeInputs, resolveAncestorEnvironmentId, VALID_PIPE_MODES };

/**
 * Terminate a session and clean up all associated streams and subscriptions.
 *
 * If the session is already in a terminal state the status update is skipped,
 * but lifecycle and subscription streams are always removed so stale handles
 * do not accumulate.
 */
export function killSessionAndCleanup(session: SessionRow): void {
  if (!TERMINAL_SESSION_STATUSES.has(session.status as SessionStatus)) {
    sessionStore.updateSession(session.id, SESSION_STATUS.STOPPED, undefined, undefined, END_REASON.KILLED);
    streamHub.publish(
      create(grackle.SessionEventSchema, {
        sessionId: session.id,
        type: grackle.EventType.STATUS,
        timestamp: new Date().toISOString(),
        content: END_REASON.KILLED,
        raw: "",
      }),
    );
    if (session.taskId) {
      const task = taskStore.getTask(session.taskId);
      if (task) {
        emit("task.updated", { taskId: task.id, workspaceId: task.workspaceId || "" });
      }
    }
  }

  // Forward kill to PowerLine so the agent process is actually terminated.
  // The orphan callback also sends a kill, but that fires asynchronously
  // after subscription cleanup — this ensures immediate process termination.
  const conn = adapterManager.getConnection(session.environmentId);
  if (conn) {
    conn.client.kill(
      create(powerline.KillRequestSchema, { id: session.id, reason: END_REASON.KILLED }),
    ).catch((err: unknown) => {
      logger.debug({ err, sessionId: session.id }, "PowerLine kill failed (process may have already exited)");
    });
  }

  // Transfer ALL pipe fds to grandparent BEFORE cleaning up subscriptions.
  // Always transfer regardless of orphaned tasks: ipc_spawn creates child sessions
  // (not tasks), so pipe subs exist even when getOrphanedTasks returns empty.
  if (session.taskId) {
    const task = taskStore.getTask(session.taskId);
    if (task) {
      const grandparentId = task.parentTaskId || ROOT_TASK_ID;
      transferAllPipeSubscriptions(task.id, grandparentId);
    }
  }

  cleanupLifecycleStream(session.id);
  const subs = streamRegistry.getSubscriptionsForSession(session.id);
  for (const sub of subs) {
    streamRegistry.unsubscribe(sub.id);
  }
}
