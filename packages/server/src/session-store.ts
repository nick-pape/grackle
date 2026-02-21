import db from "./db.js";
import { sessions, type SessionRow } from "./schema.js";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import type { SessionStatus } from "@grackle/common";

export type { SessionRow };

/** Insert a new session record into the database. */
export function createSession(
  id: string,
  envId: string,
  runtime: string,
  prompt: string,
  model: string,
  logPath: string,
): void {
  db.insert(sessions).values({ id, envId, runtime, prompt, model, logPath }).run();
}

/** Retrieve a single session by ID. */
export function getSession(id: string): SessionRow | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

/** List sessions, optionally filtered by environment and/or status. */
export function listSessions(envId?: string, status?: string): SessionRow[] {
  const conditions = [];
  if (envId) {
    conditions.push(eq(sessions.envId, envId));
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
export function listByEnv(envId: string): SessionRow[] {
  return db.select().from(sessions)
    .where(eq(sessions.envId, envId))
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
export function getActiveForEnv(envId: string): SessionRow | undefined {
  return db.select().from(sessions)
    .where(
      and(
        eq(sessions.envId, envId),
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
