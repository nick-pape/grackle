import type { AgentSession } from "./runtimes/runtime.js";

const sessions: Map<string, AgentSession> = new Map<string, AgentSession>();

/** Track an active agent session in the in-memory store. */
export function addSession(session: AgentSession): void {
  sessions.set(session.id, session);
}

/** Retrieve an active session by ID. */
export function getSession(id: string): AgentSession | undefined {
  return sessions.get(id);
}

/** Remove a session from the in-memory store. */
export function removeSession(id: string): void {
  sessions.delete(id);
}

/** Return all sessions currently tracked by the PowerLine. */
export function listAllSessions(): AgentSession[] {
  return Array.from(sessions.values());
}
