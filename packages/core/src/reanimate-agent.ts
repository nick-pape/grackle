import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { powerline, SESSION_STATUS, LOGS_DIR } from "@grackle-ai/common";
import { join } from "node:path";
import { sessionStore, taskStore, grackleHome } from "@grackle-ai/database";
import type { SessionRow } from "@grackle-ai/database";
import * as adapterManager from "./adapter-manager.js";
import { ensureLifecycleStream } from "./lifecycle-streams.js";
import { ensureStdinStream } from "./stdin-delivery.js";
import { ensurePipeStream } from "./pipe-delivery.js";
import { processEventStream } from "./event-processor.js";

/**
 * Reanimate a terminal session: validate state, reset the DB record, and fire a
 * PowerLine resume stream. Returns the updated session row (status=running).
 *
 * Throws ConnectError on any validation failure:
 *   - NOT_FOUND if the session does not exist
 *   - FAILED_PRECONDITION if the session is still active, has no runtimeSessionId,
 *     the environment already has an active session, or the environment is offline
 */
export function reanimateAgent(sessionId: string): SessionRow {
  const session = sessionStore.getSession(sessionId);
  if (!session) {
    throw new ConnectError(`Session not found: ${sessionId}`, Code.NotFound);
  }

  if (
    session.status === SESSION_STATUS.IDLE ||
    session.status === SESSION_STATUS.RUNNING ||
    session.status === SESSION_STATUS.PENDING
  ) {
    throw new ConnectError(
      `Session ${sessionId} is already active (status: ${session.status})`,
      Code.FailedPrecondition,
    );
  }

  if (!session.runtimeSessionId) {
    throw new ConnectError(
      `Session ${sessionId} has no runtime session ID — cannot reanimate`,
      Code.FailedPrecondition,
    );
  }

  const existingActive = sessionStore.getActiveForEnv(session.environmentId);
  if (existingActive) {
    throw new ConnectError(
      `Environment already has active session ${existingActive.id}`,
      Code.FailedPrecondition,
    );
  }
  // Note: the check above and reanimateSession() below are not wrapped in a DB
  // transaction, but Node.js's single-threaded event loop provides sufficient
  // serialization: this function is fully synchronous (no awaits, all SQLite
  // calls use the synchronous better-sqlite3 API), so it runs to completion
  // before any other handler can interleave.

  const conn = adapterManager.getConnection(session.environmentId);
  if (!conn) {
    throw new ConnectError(
      `Environment ${session.environmentId} not connected`,
      Code.FailedPrecondition,
    );
  }

  const powerlineReq = create(powerline.ResumeRequestSchema, {
    sessionId: session.id,
    runtimeSessionId: session.runtimeSessionId,
    runtime: session.runtime,
  });

  const logPath = session.logPath || join(grackleHome, LOGS_DIR, session.id);

  let workspaceId: string | undefined;
  let taskId: string | undefined;
  if (session.taskId) {
    const task = taskStore.getTask(session.taskId);
    if (task) {
      workspaceId = task.workspaceId || undefined;
      taskId = task.id;
    }
  }

  // Initiate the stream before mutating the DB. If resume() throws synchronously
  // the DB is never touched, so no rollback is needed.
  let resumeStream: ReturnType<typeof conn.client.resume>;
  try {
    resumeStream = conn.client.resume(powerlineReq);
  } catch (err) {
    throw new ConnectError(
      `Failed to initiate resume stream: ${String(err)}`,
      Code.Internal,
    );
  }

  sessionStore.reanimateSession(session.id);

  // Re-create lifecycle stream if it was deleted (e.g. by killAgent or a
  // "failed" event). No-op if it still exists (session went idle naturally).
  const spawnerId = session.parentSessionId || "__server__";
  ensureLifecycleStream(session.id, spawnerId);

  // Re-create stdin stream if it was deleted (same lifecycle as lifecycle stream)
  ensureStdinStream(session.id);

  // Re-create async pipe stream if this session is a child with an async pipe.
  // Sync pipes are not reconstructed — the parent's blocking consumeSync() cannot
  // be revived after a session suspension.
  if (session.pipeMode === "async" && session.parentSessionId) {
    ensurePipeStream(session.id, session.parentSessionId);
  }

  // Re-create async pipe streams for any non-terminal child sessions so that
  // messages the parent writes after reanimate are delivered correctly.
  const children = sessionStore.getChildSessions(session.id);
  for (const child of children) {
    if (child.pipeMode === "async" && child.status !== SESSION_STATUS.STOPPED) {
      ensurePipeStream(child.id, session.id);
    }
  }

  processEventStream(resumeStream, {
    sessionId: session.id,
    logPath,
    workspaceId,
    taskId,
  });

  return sessionStore.getSession(session.id)!;
}
