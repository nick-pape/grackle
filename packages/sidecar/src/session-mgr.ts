import type { AgentSession } from "./runtimes/runtime.js";

const sessions = new Map<string, AgentSession>();

export function addSession(session: AgentSession): void {
  sessions.set(session.id, session);
}

export function getSession(id: string): AgentSession | undefined {
  return sessions.get(id);
}

export function removeSession(id: string): void {
  sessions.delete(id);
}

export function listAllSessions(): AgentSession[] {
  return Array.from(sessions.values());
}
