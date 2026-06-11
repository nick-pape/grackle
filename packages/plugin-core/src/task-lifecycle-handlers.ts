/** Task lifecycle handlers extracted from task-handlers.ts (#1470). @module */
import { create } from "@bufbuild/protobuf";
import {
  grackle,
  serverTimestamp,
  GrackleError,
  NotFoundError,
  ValidationError,
  AuthError,
  PreconditionError,
} from "@grackle-ai/common";
import {
  SESSION_STATUS,
  TERMINAL_SESSION_STATUSES,
  type SessionStatus,
  END_REASON,
  TASK_STATUS,
  ROOT_TASK_ID,
  LOGS_DIR,
} from "@grackle-ai/common";
import { getDatabaseStores, grackleHome } from "@grackle-ai/database";
import { join } from "node:path";
import { adapterManager } from "@grackle-ai/core";
import { streamHub } from "@grackle-ai/core";
import { streamRegistry } from "@grackle-ai/core";
import { emit } from "@grackle-ai/core";
import { processEventStream } from "@grackle-ai/core";
import { logger } from "@grackle-ai/core";
import { getTraceId } from "@grackle-ai/core";
import { computeTaskStatus } from "@grackle-ai/core";
import { revokeTask } from "@grackle-ai/auth";
import { cleanupLifecycleStream, ensureLifecycleStream } from "./lifecycle.js";
import { transferAllPipeSubscriptions } from "./signals/orphan-reparent.js";
import { taskRowToProto, sessionRowToProto } from "./grpc-proto-converters.js";
import { requireTask } from "./require-helpers.js";

/** Mark a task as complete and clean up active sessions. */
export async function completeTask(req: grackle.TaskId): Promise<grackle.Task> {
  const { sessionStore, taskStore } = getDatabaseStores();
  if (req.id === ROOT_TASK_ID) {
    throw new AuthError("Cannot complete the system task");
  }
  const task = requireTask(req.id);

  taskStore.markTaskComplete(task.id, TASK_STATUS.COMPLETE);

  // Transfer ALL pipe fds from this task's sessions to the grandparent BEFORE
  // closing sessions — once sessions are cleaned up, their subscriptions are gone.
  // Always transfer regardless of orphaned tasks: ipc_spawn creates child sessions
  // (not tasks), so pipe subs exist even when getOrphanedTasks returns empty.
  const grandparentId = task.parentTaskId || ROOT_TASK_ID;
  transferAllPipeSubscriptions(task.id, grandparentId);

  // Close lifecycle FDs for any active sessions — cascades to STOPPED via orphan callback
  const activeSessions = sessionStore.getActiveSessionsForTask(req.id);
  for (const activeSession of activeSessions) {
    cleanupLifecycleStream(activeSession.id);
    const subs = streamRegistry.getSubscriptionsForSession(activeSession.id);
    for (const sub of subs) {
      streamRegistry.unsubscribe(sub.id);
    }
  }

  // Check for newly unblocked tasks
  if (task.workspaceId) {
    const unblocked = taskStore.checkAndUnblock(task.workspaceId);
    for (const t of unblocked) {
      streamHub.publish(
        create(grackle.SessionEventSchema, {
          sessionId: "",
          type: grackle.EventType.SYSTEM,
          timestamp: serverTimestamp(),
          content: JSON.stringify({
            type: "task_unblocked",
            taskId: t.id,
            title: t.title,
          }),
          raw: "",
        }),
      );
    }
  }

  // NB: we do NOT revoke the task's scoped tokens here. complete/stop are not
  // truly terminal — the task can be resumed, and resume reuses the original
  // token (powerline `runtime.resume` does not re-mint), so revoking here would
  // 401 the resumed agent's MCP calls. Only deleteTask revokes (GHSA-f9ff F12).
  emit("task.completed", { taskId: task.id, workspaceId: task.workspaceId || "" });
  logger.info({ taskId: task.id }, "Task completed");
  const row = taskStore.getTask(task.id);
  const taskSessions = sessionStore.listSessionsForTask(task.id);
  const { status, latestSessionId } = computeTaskStatus(row!.status, taskSessions);
  return taskRowToProto(row!, undefined, status, latestSessionId);
}

/** Set the workpad JSON for a task. */
export async function setWorkpad(req: grackle.SetWorkpadRequest): Promise<grackle.Task> {
  const { sessionStore, taskStore } = getDatabaseStores();
  const task = requireTask(req.taskId);
  // Validate workpad is a valid JSON object
  try {
    const parsed: unknown = JSON.parse(req.workpad);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ValidationError("Workpad must be a JSON object");
    }
  } catch (err) {
    if (err instanceof GrackleError) {
      throw err;
    }
    throw new ValidationError("Workpad must be valid JSON");
  }
  const MAX_WORKPAD_BYTES = 64 * 1024; // 64 KB
  const workpadBytes = Buffer.byteLength(req.workpad, "utf8");
  if (workpadBytes > MAX_WORKPAD_BYTES) {
    throw new ValidationError(`Workpad exceeds maximum size of ${MAX_WORKPAD_BYTES} bytes`);
  }
  taskStore.setWorkpad(req.taskId, req.workpad);
  const row = taskStore.getTask(req.taskId)!;
  const taskSessions = sessionStore.listSessionsForTask(req.taskId);
  const { status, latestSessionId } = computeTaskStatus(row.status, taskSessions);
  return taskRowToProto(row, undefined, status, latestSessionId);
}

/** Resume the latest session for a task. */
export async function resumeTask(req: grackle.TaskId): Promise<grackle.Session> {
  const { sessionStore, taskStore } = getDatabaseStores();
  const task = requireTask(req.id);

  const latestSession = sessionStore.getLatestSessionForTask(req.id);
  if (!latestSession) {
    throw new PreconditionError(`Task ${req.id} has no sessions to resume`);
  }
  if (
    !([SESSION_STATUS.STOPPED, SESSION_STATUS.SUSPENDED] as string[]).includes(latestSession.status)
  ) {
    throw new PreconditionError(
      `Latest session ${latestSession.id} is not resumable (status: ${latestSession.status})`,
    );
  }
  if (!latestSession.runtimeSessionId) {
    throw new PreconditionError(
      `Latest session ${latestSession.id} has no runtime session ID — cannot resume`,
    );
  }

  const conn = adapterManager.getConnection(latestSession.environmentId);
  if (!conn) {
    throw new PreconditionError(`Environment ${latestSession.environmentId} not connected`);
  }

  const logPath = latestSession.logPath || join(grackleHome, LOGS_DIR, latestSession.id);

  // Initiate the stream before mutating the DB. If reanimate() throws
  // synchronously the DB is never touched, so no rollback is needed.
  const resumeStream = conn.transport.reanimate({
    sessionId: latestSession.id,
    runtimeSessionId: latestSession.runtimeSessionId,
    runtime: latestSession.runtime,
  });

  // Reset session DB row to RUNNING (clears endedAt, error, etc.)
  sessionStore.reanimateSession(latestSession.id);

  // Re-create lifecycle stream if it was deleted during kill/stop
  const resumeSpawnerId = latestSession.parentSessionId || "__server__";
  ensureLifecycleStream(latestSession.id, resumeSpawnerId);

  processEventStream(resumeStream, {
    sessionId: latestSession.id,
    logPath,
    workspaceId: task.workspaceId ?? undefined,
    taskId: task.id,
    traceId: getTraceId(),
  });

  emit("task.started", {
    taskId: task.id,
    sessionId: latestSession.id,
    workspaceId: task.workspaceId || "",
  });
  logger.info({ taskId: task.id, sessionId: latestSession.id }, "Task resumed");

  const row = sessionStore.getSession(latestSession.id);
  return sessionRowToProto(row!);
}

/** Stop a task by terminating all its active sessions. */
export async function stopTask(req: grackle.TaskId): Promise<grackle.Task> {
  const { sessionStore, taskStore } = getDatabaseStores();
  const task = requireTask(req.id);

  // Terminate all active sessions for this task using the fd-closure pattern
  const activeSessions = sessionStore.getActiveSessionsForTask(req.id);
  for (const activeSession of activeSessions) {
    cleanupLifecycleStream(activeSession.id);
    const subs = streamRegistry.getSubscriptionsForSession(activeSession.id);
    for (const sub of subs) {
      streamRegistry.unsubscribe(sub.id);
    }
    const current = sessionStore.getSession(activeSession.id);
    if (current && !TERMINAL_SESSION_STATUSES.has(current.status as SessionStatus)) {
      sessionStore.updateSession(
        activeSession.id,
        SESSION_STATUS.STOPPED,
        undefined,
        undefined,
        END_REASON.INTERRUPTED,
      );
      streamHub.publish(
        create(grackle.SessionEventSchema, {
          sessionId: activeSession.id,
          type: grackle.EventType.STATUS,
          timestamp: serverTimestamp(),
          content: END_REASON.INTERRUPTED,
          raw: "",
        }),
      );
    }
  }

  // Mark task complete
  taskStore.markTaskComplete(req.id, TASK_STATUS.COMPLETE);

  // Check for newly unblocked tasks
  if (task.workspaceId) {
    taskStore.checkAndUnblock(task.workspaceId);
  }

  // NB: stop is resumable and resume reuses the original scoped token, so we do
  // NOT revoke here (it would 401 the resumed agent). Only deleteTask revokes.
  emit("task.completed", { taskId: task.id, workspaceId: task.workspaceId || "" });
  logger.info({ taskId: req.id }, "Task stopped");
  const updated = taskStore.getTask(req.id);
  const taskSessions = sessionStore.listSessionsForTask(req.id);
  const { status, latestSessionId } = computeTaskStatus(updated!.status, taskSessions);
  return taskRowToProto(updated!, undefined, status, latestSessionId);
}

/** Delete a task and all its sessions. */
export async function deleteTask(req: grackle.TaskId): Promise<grackle.Empty> {
  const { sessionStore, taskStore } = getDatabaseStores();
  if (req.id === ROOT_TASK_ID) {
    throw new AuthError("Cannot delete the system task");
  }
  const task = requireTask(req.id);
  const children = taskStore.getChildren(req.id);
  if (children.length > 0) {
    throw new PreconditionError("Cannot delete task with children. Delete children first.");
  }

  // Terminate all active sessions via lifecycle cleanup before deleting the task
  const activeSessions = sessionStore.getActiveSessionsForTask(req.id);
  for (const activeSession of activeSessions) {
    cleanupLifecycleStream(activeSession.id);
    const subs = streamRegistry.getSubscriptionsForSession(activeSession.id);
    for (const sub of subs) {
      streamRegistry.unsubscribe(sub.id);
    }
  }

  const changes = taskStore.deleteTask(req.id);
  if (changes === 0) {
    logger.error({ taskId: req.id }, "deleteTask returned 0 changes despite task existing");
    throw new NotFoundError(`Failed to delete task ${req.id}: no rows affected`, {
      taskId: req.id,
    });
  }
  // Revoke the deleted task's scoped MCP tokens (GHSA-f9ff-5x35-7gfw F12). A
  // deleted task is never resumed, so this is permanent (until the 24h TTL prune).
  revokeTask(req.id);

  emit("task.deleted", { taskId: req.id, workspaceId: task.workspaceId || "" });
  logger.info({ taskId: req.id }, "Task deleted");
  return create(grackle.EmptySchema, {});
}
