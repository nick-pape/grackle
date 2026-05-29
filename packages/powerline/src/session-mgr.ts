import type { AgentEvent, AgentSession } from "@grackle-ai/runtime-sdk";

const sessions: Map<string, AgentSession> = new Map<string, AgentSession>();

// ─── Parked Sessions ────────────────────────────────────────

/** Buffered events from sessions whose AHP subscriber disconnected before all events were delivered. */
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

/** Store buffered events from a session whose AHP subscriber disconnected. */
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

// ─── Session Pumps ──────────────────────────────────────────

/**
 * Per-session pump record. PowerLine drives {@link AgentSession.stream} exactly
 * once per session — events flow through this pump into {@link buffer}, and
 * any number of AHP `subscribe` forwarders tail the buffer concurrently.
 *
 * This is the moat between the AHP wire (where `subscribe` may be invoked many
 * times — including by the same client across reconnects) and the runtime
 * contract (where `stream()` is a one-shot driver that starts the agent).
 * Without the pump, every `subscribe` would re-enter `stream()` and either
 * stack listeners (stub runtimes) or re-kick `runSession()` (production
 * runtimes via `BaseAgentSession`).
 */
export interface SessionPump {
  /** The session being driven. */
  readonly session: AgentSession;
  /**
   * Events the pump has pulled from `session.stream()`. Forwarders read this
   * by index; the buffer is append-only for the life of the session.
   */
  readonly buffer: AgentEvent[];
  /** True once `session.stream()` has returned (kill, natural exit, or error). */
  done: boolean;
  /**
   * Sleeping forwarders. The pump wakes all entries on each buffer push and
   * on pump completion. Cancelled forwarders pluck their own resolver out of
   * the set before resolving, so cleanup is local.
   */
  readonly waiters: Set<() => void>;
  /** Handle to the pump task — used to coordinate teardown on dispose. */
  readonly task: Promise<void>;
}

const sessionPumps: Map<string, SessionPump> = new Map<string, SessionPump>();

/**
 * Register a session and start its pump. Returns the {@link SessionPump} so
 * the caller can hand it directly to a forwarder without a separate lookup.
 *
 * The pump task drains `session.stream()` into `pump.buffer` and wakes any
 * sleeping forwarders. On natural exit it removes the session from the
 * registry — handlers don't need to do that cleanup themselves.
 */
export function startSessionPump(session: AgentSession): SessionPump {
  addSession(session);
  const pump: SessionPump = {
    session,
    buffer: [],
    done: false,
    waiters: new Set<() => void>(),
    task: Promise.resolve(),
  };
  (pump as { task: Promise<void> }).task = runPump(pump);
  sessionPumps.set(session.id, pump);
  return pump;
}

/** Retrieve the pump record for a session, if one is registered. */
export function getSessionPump(id: string): SessionPump | undefined {
  return sessionPumps.get(id);
}

/** Remove and unregister a session's pump (idempotent). */
export function deleteSessionPump(id: string): void {
  sessionPumps.delete(id);
}

/** Wake every forwarder currently sleeping on this pump. */
function wakePumpWaiters(pump: SessionPump): void {
  const waiters = [...pump.waiters];
  pump.waiters.clear();
  for (const wake of waiters) {
    wake();
  }
}

async function runPump(pump: SessionPump): Promise<void> {
  try {
    for await (const event of pump.session.stream()) {
      pump.buffer.push(event);
      wakePumpWaiters(pump);
    }
  } catch {
    // Stream errored — let the session die normally. The pump's natural-exit
    // cleanup below still runs.
  } finally {
    pump.done = true;
    wakePumpWaiters(pump);
    // Natural pump exit removes the session. The disconnect path (which parks
    // the unsent tail) calls `deleteSessionPump` + `removeSession` explicitly
    // before this runs, so the `sessions.has` guard keeps us idempotent.
    if (sessions.has(pump.session.id)) {
      removeSession(pump.session.id);
      sessionPumps.delete(pump.session.id);
    }
  }
}
