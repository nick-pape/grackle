import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { powerline, SESSION_STATUS, LOGS_DIR } from "@grackle-ai/common";
import { join } from "node:path";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import * as taskStore from "./task-store.js";
import { processEventStream } from "./event-processor.js";
import { grackleHome } from "./paths.js";
import type { SessionRow } from "./session-store.js";

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

  // IDLE without endReason means truly active (waiting for input) — reject reanimate.
  // IDLE with endReason="completed" means the agent is done — allow reanimate.
  const isActiveIdle = session.status === SESSION_STATUS.IDLE && !session.endReason;
  if (
    isActiveIdle ||
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

  processEventStream(resumeStream, {
    sessionId: session.id,
    logPath,
    workspaceId,
    taskId,
  });

  return sessionStore.getSession(session.id)!;
}
