import db from "./db.js";
import type { SessionStatus } from "@grackle/common";

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

export function getSession(id: string): SessionRow | undefined {
  return stmts.get.get(id) as SessionRow | undefined;
}

export function listSessions(envId?: string, status?: string): SessionRow[] {
  const e = envId || "";
  const s = status || "";
  return stmts.listFiltered.all(e, e, s, s) as SessionRow[];
}

export function listByEnv(envId: string): SessionRow[] {
  return stmts.listByEnv.all(envId) as SessionRow[];
}

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

export function updateSessionStatus(id: string, status: SessionStatus): void {
  stmts.updateStatus.run(status, id);
}

export function getActiveForEnv(envId: string): SessionRow | undefined {
  return stmts.getActiveForEnv.get(envId) as SessionRow | undefined;
}

export function incrementTurns(id: string): void {
  stmts.incrementTurns.run(id);
}
