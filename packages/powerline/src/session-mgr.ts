import type { AgentEvent, AgentSession } from "./runtimes/runtime.js";

const sessions: Map<string, AgentSession> = new Map<string, AgentSession>();

// ─── Parked Sessions ────────────────────────────────────────

/** Buffered events from sessions whose gRPC stream was aborted before all events were delivered. */
const parkedEvents: Map<string, AgentEvent[]> = new Map<string, AgentEvent[]>();

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

// ─── Parked Session Management ──────────────────────────────

/** Store buffered events from a session whose gRPC stream was aborted. */
export function parkSession(sessionId: string, events: AgentEvent[]): void {
  parkedEvents.set(sessionId, events);
}

/** Retrieve and remove a parked session's buffered events. Returns undefined if not parked. */
export function drainParkedSession(sessionId: string): AgentEvent[] | undefined {
  const events = parkedEvents.get(sessionId);
  if (events) {
    parkedEvents.delete(sessionId);
  }
  return events;
}

/** Check if a session has parked events waiting to be drained. */
export function isParked(sessionId: string): boolean {
  return parkedEvents.has(sessionId);
}
