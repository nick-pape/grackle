import db from "./db.js";
import type { SessionStatus } from "@grackle/common";

/** Row shape for a session record in the SQLite database. */
export interface SessionRow {
  id: string;
  env_id: string;
  runtime: string;
  runtime_session_id: string | null;
  prompt: string;
  model: string;
  status: string;
  log_path: string | null;
  turns: number;
  started_at: string;
  suspended_at: string | null;
  ended_at: string | null;
  error: string | null;
}

const stmts = {
  create: db.prepare(`
    INSERT INTO sessions (id, env_id, runtime, prompt, model, log_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  get: db.prepare("SELECT * FROM sessions WHERE id = ?"),
  list: db.prepare("SELECT * FROM sessions ORDER BY started_at DESC"),
  listByEnv: db.prepare("SELECT * FROM sessions WHERE env_id = ? ORDER BY started_at DESC"),
  listFiltered: db.prepare("SELECT * FROM sessions WHERE (? = '' OR env_id = ?) AND (? = '' OR status = ?) ORDER BY started_at DESC"),
  update: db.prepare("UPDATE sessions SET status = ?, runtime_session_id = ?, ended_at = ?, error = ? WHERE id = ?"),
  updateStatus: db.prepare("UPDATE sessions SET status = ? WHERE id = ?"),
  getActiveForEnv: db.prepare(
    "SELECT * FROM sessions WHERE env_id = ? AND status IN ('pending', 'running', 'waiting_input')"
  ),
  incrementTurns: db.prepare("UPDATE sessions SET turns = turns + 1 WHERE id = ?"),
};

/** Insert a new session record into the database. */
export function createSession(
  id: string,
  envId: string,
  runtime: string,
  prompt: string,
  model: string,
  logPath: string
): void {
  stmts.create.run(id, envId, runtime, prompt, model, logPath);
}

/** Retrieve a single session by ID. */
export function getSession(id: string): SessionRow | undefined {
  return stmts.get.get(id) as SessionRow | undefined;
}

/** List sessions, optionally filtered by environment and/or status. */
export function listSessions(envId?: string, status?: string): SessionRow[] {
  const e = envId || "";
  const s = status || "";
  return stmts.listFiltered.all(e, e, s, s) as SessionRow[];
}

/** List all sessions belonging to a specific environment. */
export function listByEnv(envId: string): SessionRow[] {
  return stmts.listByEnv.all(envId) as SessionRow[];
}

/** Update a session's status, runtime session ID, and error; auto-sets `ended_at` for terminal states. */
export function updateSession(
  id: string,
  status: SessionStatus,
  runtimeSessionId?: string,
  error?: string
): void {
  const ended = ["completed", "failed", "killed"].includes(status)
    ? new Date().toISOString()
    : null;
  stmts.update.run(status, runtimeSessionId || null, ended, error || null, id);
}

/** Update only the status column of a session. */
export function updateSessionStatus(id: string, status: SessionStatus): void {
  stmts.updateStatus.run(status, id);
}

/** Get the currently active (pending/running/waiting_input) session for an environment, if any. */
export function getActiveForEnv(envId: string): SessionRow | undefined {
  return stmts.getActiveForEnv.get(envId) as SessionRow | undefined;
}

/** Increment the turn counter for a session. */
export function incrementTurns(id: string): void {
  stmts.incrementTurns.run(id);
}
