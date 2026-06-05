import {
  SESSION_STATUS,
  LOGS_DIR,
  GrackleError,
  Code,
  NotFoundError,
  PreconditionError,
} from "@grackle-ai/common";
import { type ServerActionEnvelope } from "@grackle-ai/adapter-sdk";
import { join } from "node:path";
import { sessionStore, taskStore, grackleHome } from "@grackle-ai/database";
import type { SessionModel } from "./domain/index.js";
import { toSessionModel } from "./domain/index.js";
import * as adapterManager from "./adapter-manager.js";
import { ensureLifecycleStream } from "./lifecycle-streams.js";
import { ensureStdinStream } from "./stdin-delivery.js";
import { ensurePipeStream } from "./pipe-delivery.js";
import { processEventStream } from "./event-processor.js";

/**
 * Reanimate a terminal session: validate state, reset the DB record, and fire a
 * PowerLine resume stream. Returns the updated session as a domain model (status=running).
 *
 * Throws on any validation failure:
 *   - NotFoundError if the session does not exist
 *   - PreconditionError if the session is still active, has no runtimeSessionId,
 *     the environment already has an active session, or the environment is offline
 */
export function reanimateAgent(sessionId: string): SessionModel {
  const session = sessionStore.getSession(sessionId);
  if (!session) {
    throw new NotFoundError(`Session not found: ${sessionId}`);
  }

  if (
    session.status === SESSION_STATUS.IDLE ||
    session.status === SESSION_STATUS.RUNNING ||
    session.status === SESSION_STATUS.PENDING
  ) {
    throw new PreconditionError(
      `Session ${sessionId} is already active (status: ${session.status})`,
    );
  }

  if (!session.runtimeSessionId) {
    throw new PreconditionError(
      `Session ${sessionId} has no runtime session ID — cannot reanimate`,
    );
  }

  const existingActive = sessionStore.getActiveForEnv(session.environmentId);
  if (existingActive) {
    throw new PreconditionError(`Environment already has active session ${existingActive.id}`);
  }
  // Note: the check above and reanimateSession() below are not wrapped in a DB
  // transaction, but Node.js's single-threaded event loop provides sufficient
  // serialization: this function is fully synchronous (no awaits, all SQLite
  // calls use the synchronous better-sqlite3 API), so it runs to completion
  // before any other handler can interleave.

  const conn = adapterManager.getConnection(session.environmentId);
  if (!conn) {
    throw new PreconditionError(`Environment ${session.environmentId} not connected`);
  }

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

  // Initiate the stream before mutating the DB. If reanimate() throws synchronously
  // the DB is never touched, so no rollback is needed.
  let resumeStream: AsyncIterable<ServerActionEnvelope>;
  try {
    resumeStream = conn.transport.reanimate({
      sessionId: session.id,
      runtimeSessionId: session.runtimeSessionId,
      runtime: session.runtime,
    });
  } catch (err) {
    throw new GrackleError(`Failed to initiate resume stream: ${String(err)}`, Code.Internal);
  }

  sessionStore.reanimateSession(session.id);

  // Re-create lifecycle stream if it was deleted (e.g. by killAgent or a
  // "failed" event). No-op if it still exists (session went idle naturally).
  const spawnerId = session.parentSessionId || "__server__";
  ensureLifecycleStream(session.id, spawnerId);

  // Re-create stdin stream if it was deleted (same lifecycle as lifecycle stream)
  ensureStdinStream(session.id);

  // Re-create pipe stream if this session is a child with a non-detach pipe.
  // For async pipes: reconstructs the same topology as at spawn time.
  // For sync pipes: promotes to async delivery — the parent's blocking consumeSync()
  // cannot be revived after suspension, but async delivery via sendInput can still
  // deliver the child's completion message to the parent.
  if (session.parentSessionId && session.pipeMode && session.pipeMode !== "detach") {
    ensurePipeStream(session.id, session.parentSessionId);
  }

  // Re-create pipe streams for any non-terminal child sessions so that
  // messages the parent writes after reanimate are delivered correctly.
  const children = sessionStore.getChildSessions(session.id);
  for (const child of children) {
    if (child.pipeMode && child.pipeMode !== "detach" && child.status !== SESSION_STATUS.STOPPED) {
      ensurePipeStream(child.id, session.id);
    }
  }

  processEventStream(resumeStream, {
    sessionId: session.id,
    logPath,
    workspaceId,
    taskId,
  });

  return toSessionModel(sessionStore.getSession(session.id)!);
}
