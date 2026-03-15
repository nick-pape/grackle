import db from "./db.js";
import { sessions, type SessionRow } from "./schema.js";
import { eq, and, inArray, desc, asc, sql } from "drizzle-orm";
import type { SessionStatus } from "@grackle-ai/common";

export type { SessionRow };

/** Insert a new session record into the database. */
export function createSession(
  id: string,
  environmentId: string,
  runtime: string,
  prompt: string,
  model: string,
  logPath: string,
  taskId: string = "",
  personaId: string = "",
): void {
  db.insert(sessions).values({
    id,
    environmentId,
    runtime,
    prompt,
    model,
    logPath,
    taskId,
    personaId,
    startedAt: new Date().toISOString(),
  }).run();
}

/** Retrieve a single session by ID. */
export function getSession(id: string): SessionRow | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

/** List sessions, optionally filtered by environment and/or status. */
export function listSessions(environmentId?: string, status?: string): SessionRow[] {
  const conditions = [];
  if (environmentId) {
    conditions.push(eq(sessions.environmentId, environmentId));
  }
  if (status) {
    conditions.push(eq(sessions.status, status));
  }

  const query = db.select().from(sessions);
  if (conditions.length > 0) {
    return query.where(and(...conditions)).orderBy(desc(sessions.startedAt)).all();
  }
  return query.orderBy(desc(sessions.startedAt)).all();
}

/** List all sessions belonging to a specific environment. */
export function listByEnv(environmentId: string): SessionRow[] {
  return db.select().from(sessions)
    .where(eq(sessions.environmentId, environmentId))
    .orderBy(desc(sessions.startedAt))
    .all();
}

/** Update a session's status, runtime session ID, and error; auto-sets `endedAt` for terminal states. */
export function updateSession(
  id: string,
  status: SessionStatus,
  runtimeSessionId?: string,
  error?: string,
): void {
  const endedAt = ["completed", "failed", "killed"].includes(status)
    ? new Date().toISOString()
    : null;
  db.update(sessions)
    .set({
      status,
      runtimeSessionId: runtimeSessionId ?? null,
      endedAt,
      error: error ?? null,
    })
    .where(eq(sessions.id, id))
    .run();
}

/** Update only the status column of a session. */
export function updateSessionStatus(id: string, status: SessionStatus): void {
  db.update(sessions)
    .set({ status })
    .where(eq(sessions.id, id))
    .run();
}

/** Get the currently active (pending/running/waiting_input) session for an environment, if any. */
export function getActiveForEnv(environmentId: string): SessionRow | undefined {
  return db.select().from(sessions)
    .where(
      and(
        eq(sessions.environmentId, environmentId),
        inArray(sessions.status, ["pending", "running", "waiting_input"]),
      ),
    )
    .get();
}

/** Increment the turn counter for a session. */
export function incrementTurns(id: string): void {
  db.update(sessions)
    .set({ turns: sql`${sessions.turns} + 1` })
    .where(eq(sessions.id, id))
    .run();
}

/** Delete all sessions belonging to a specific environment. */
export function deleteByEnvironment(environmentId: string): void {
  db.delete(sessions).where(eq(sessions.environmentId, environmentId)).run();
}

/** Update the taskId for an existing session (late-bind). */
export function setSessionTask(id: string, taskId: string): void {
  db.update(sessions)
    .set({ taskId })
    .where(eq(sessions.id, id))
    .run();
}

/** List all sessions for a specific task, ordered chronologically (oldest first). */
export function listSessionsForTask(taskId: string): SessionRow[] {
  return db.select().from(sessions)
    .where(eq(sessions.taskId, taskId))
    .orderBy(asc(sessions.startedAt), asc(sessions.id))
    .all();
}

/** Get the most recent session for a task (by startedAt DESC, id DESC). */
export function getLatestSessionForTask(taskId: string): SessionRow | undefined {
  return db.select().from(sessions)
    .where(eq(sessions.taskId, taskId))
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .limit(1)
    .get();
}

/** Get all active (non-terminal) sessions for a task. */
export function getActiveSessionsForTask(taskId: string): SessionRow[] {
  return db.select().from(sessions)
    .where(
      and(
        eq(sessions.taskId, taskId),
        inArray(sessions.status, ["pending", "running", "waiting_input"]),
      ),
    )
    .all();
}

/** Batch-fetch all sessions for a set of task IDs. Avoids N+1 queries for listTasks. */
export function listSessionsByTaskIds(taskIds: string[]): SessionRow[] {
  if (taskIds.length === 0) {
    return [];
  }
  return db.select().from(sessions)
    .where(inArray(sessions.taskId, taskIds))
    .orderBy(asc(sessions.startedAt), asc(sessions.id))
    .all();
}
