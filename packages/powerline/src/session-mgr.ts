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
/**
 * Minimal cross-module shape of a forwarder's tracking state. Mirrors the
 * private interface in `ahp-handlers.ts` to the fields the pump needs without
 * dragging in the mapper/serverSeq machinery. Keeping the surface small means
 * adding a new forwarder field doesn't ripple here.
 */
export interface PumpForwarder {
  /** Absolute index into the pump's event stream (in `bufferStartIndex` space). */
  pos: number;
  /** True once the forwarder has been cancelled (e.g. resubscribe, disconnect). */
  cancelled: boolean;
}

export interface SessionPump {
  /** The session being driven. */
  readonly session: AgentSession;
  /**
   * Events the pump has pulled from `session.stream()` and not yet trimmed.
   * Indexed locally — translate to absolute event index by adding
   * {@link bufferStartIndex}. The pump trims from the front once every
   * registered forwarder has advanced past an event, so memory is bounded by
   * the slowest forwarder's lag (typically a handful of events; zero when no
   * subscribers are attached).
   */
  readonly buffer: AgentEvent[];
  /**
   * Total number of events the pump has dropped from the front of
   * {@link buffer}. The absolute index of the oldest still-buffered event is
   * `bufferStartIndex`; of the next-to-come is `bufferStartIndex +
   * buffer.length`. Forwarders track their position in this absolute space so
   * trims don't shift their cursor.
   */
  bufferStartIndex: number;
  /** True once `session.stream()` has returned (kill, natural exit, or error). */
  done: boolean;
  /**
   * Sleeping forwarders. The pump wakes all entries on each buffer push and
   * on pump completion. Cancelled forwarders pluck their own resolver out of
   * the set before resolving, so cleanup is local.
   */
  readonly waiters: Set<() => void>;
  /**
   * Forwarders currently tailing this pump. Their `pos` is consulted on each
   * push to compute the trim watermark — once every registered forwarder has
   * advanced past an event, the pump drops it from {@link buffer}.
   */
  readonly forwarders: Set<PumpForwarder>;
  /**
   * Monotonic count of forwarders ever attached to this pump. The first
   * subscriber on a fresh pump replays from the buffer's logical start
   * (`bufferStartIndex`) so it sees runtime-emitted setup events
   * (`runtime_session_id`, initial system messages) that landed between
   * `createSession` and `subscribe`. Subsequent forwarders attach at the
   * current tail — true mid-stream resubscribes see only future events;
   * missed events from a prior subscriber arrive via the parked-replay path.
   */
  totalForwardersAttached: number;
  /**
   * Captured at startSessionPump time. Fired exactly once on the
   * last-forwarder-detach path *after* a natural pump exit, so handler-level
   * owners (ahp-handlers' `ClientState.sessionIds`) get to clean up.
   * Stashed here rather than as a `runPump` parameter so `unregisterPumpForwarder`
   * can dispatch it from its own callsite.
   */
  onNaturalExit?: PumpNaturalExitHandler;
  /** Handle to the pump task — used to coordinate teardown on dispose. */
  readonly task: Promise<void>;
}

const sessionPumps: Map<string, SessionPump> = new Map<string, SessionPump>();

/**
 * Optional cleanup hook fired on the *last-forwarder-detach path* after a
 * natural pump exit. Lets handler-level owners (typically ahp-handlers) prune
 * their own owning bookkeeping (`ClientState.sessionIds`) for the now-dead
 * session without scanning every client on every session end.
 *
 * Specifically NOT fired from the pump's own finally — the pump can complete
 * before any forwarder ever attaches (a "fast child" stub finishes between
 * `createSession` and `subscribe` over the wire). Auto-removing the session
 * there would race the still-arriving subscribe and cause it to fail with
 * "Unknown session channel," surface as a synthetic `status: failed` on the
 * server side, and break the createSession+subscribe pairing.
 */
export type PumpNaturalExitHandler = (sessionId: string) => void;

/**
 * Register a session and start its pump. Returns the {@link SessionPump} so
 * the caller can hand it directly to a forwarder without a separate lookup.
 *
 * The pump task drains `session.stream()` into `pump.buffer` and wakes any
 * sleeping forwarders. On natural exit it removes the session from the
 * registry — handlers don't need to do that cleanup themselves.
 *
 * @param onNaturalExit Optional callback fired from the pump's `finally`
 *   block when the pump exits because `session.stream()` returned (not when
 *   dispose / disconnect tore it down — those paths take responsibility for
 *   their own cleanup). The pump invokes the callback after removing itself
 *   from the session registry, so subsequent lookups see the session gone.
 */
export function startSessionPump(
  session: AgentSession,
  onNaturalExit?: PumpNaturalExitHandler,
): SessionPump {
  addSession(session);
  const pump: SessionPump = {
    session,
    buffer: [],
    bufferStartIndex: 0,
    done: false,
    waiters: new Set<() => void>(),
    forwarders: new Set<PumpForwarder>(),
    totalForwardersAttached: 0,
    onNaturalExit,
    task: Promise.resolve(),
  };
  (pump as { task: Promise<void> }).task = runPump(pump);
  sessionPumps.set(session.id, pump);
  return pump;
}

/**
 * Register a forwarder as an active tail-reader of `pump`. The pump consults
 * the set on each push to decide what's safe to trim. The caller is
 * responsible for calling {@link unregisterPumpForwarder} when the forwarder
 * exits — failure to unregister pins the buffer at the forwarder's last
 * position and defeats the trim. Also bumps the pump's monotonic
 * `totalForwardersAttached` counter, which forwarders read to decide whether
 * they're the first-ever subscriber (replay from buffer start) or a
 * resubscriber (start at current tail).
 */
export function registerPumpForwarder(pump: SessionPump, forwarder: PumpForwarder): void {
  pump.forwarders.add(forwarder);
  pump.totalForwardersAttached++;
}

/**
 * Unregister a forwarder; safe to call multiple times. When the *last*
 * forwarder leaves *after* the pump has already finished naturally
 * (`pump.done && pump.totalForwardersAttached > 0`), this is also where the
 * session + pump get removed from the registry — keeping the session alive
 * until the wire-side reader has drained it avoids the createSession-then-
 * subscribe race where a fast child completes before the server's subscribe
 * arrives.
 */
export function unregisterPumpForwarder(pump: SessionPump, forwarder: PumpForwarder): void {
  pump.forwarders.delete(forwarder);
  if (
    pump.done &&
    pump.forwarders.size === 0 &&
    pump.totalForwardersAttached > 0 &&
    sessions.has(pump.session.id)
  ) {
    removeSession(pump.session.id);
    sessionPumps.delete(pump.session.id);
    pump.onNaturalExit?.(pump.session.id);
  }
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
      trimPumpBuffer(pump);
    }
  } catch {
    // Stream errored — let the session die normally. The pump just goes
    // `done` here; cleanup happens on the last-forwarder-detach path.
  } finally {
    pump.done = true;
    wakePumpWaiters(pump);
    // We intentionally do *not* removeSession/deleteSessionPump here. A fast
    // child can finish between `createSession` and `subscribe` on the wire;
    // removing the session at this point would race the still-arriving
    // subscribe and cause it to fail with "Unknown session channel," which
    // surfaces as a synthetic `status: failed` on the server side. Instead,
    // `unregisterPumpForwarder` does the removal when the last forwarder
    // leaves *after* a natural pump exit; if no forwarder ever attaches the
    // session lingers until dispose/onDisconnect explicitly tears it down.
  }
}

/**
 * Hard cap on the pump buffer when no active forwarders constrain it. Keeps
 * memory bounded for the "session is emitting but nobody's subscribed yet"
 * window (typically short, but could be longer if a client calls
 * `createSession` and then takes its time before `subscribe`). The cap
 * discards from the front; future late subscribers see only the surviving
 * tail, matching the "subscribe = future events only" semantics for
 * resubscribes — old events are *not* meant to be replayed across
 * resubscribes (that's the parked-replay path's job). The first-ever
 * subscribe on a fresh pump is the only exception: it replays from
 * `bufferStartIndex`, so if events were capped before the first subscribe
 * attached, they're lost (acceptable for the bounded-memory backstop).
 */
const PUMP_BUFFER_NO_SUBSCRIBER_CAP: number = 1000;

/**
 * Drop events from the front of the pump buffer once every registered
 * forwarder has advanced past them. Called after each push so the buffer is
 * bounded by the slowest active forwarder's lag. When no forwarders are
 * attached the buffer is held intact (so events stay parkable on disconnect),
 * subject to {@link PUMP_BUFFER_NO_SUBSCRIBER_CAP} as a backstop against
 * unbounded growth in the no-subscriber window.
 */
function trimPumpBuffer(pump: SessionPump): void {
  let safe: number = Number.POSITIVE_INFINITY;
  for (const f of pump.forwarders) {
    if (f.cancelled) {
      continue;
    }
    if (f.pos < safe) {
      safe = f.pos;
    }
  }
  if (!Number.isFinite(safe)) {
    // No active forwarder — fall back to a buffer-size cap so a session
    // emitting into the void doesn't grow without bound.
    const overflow = pump.buffer.length - PUMP_BUFFER_NO_SUBSCRIBER_CAP;
    if (overflow > 0) {
      pump.buffer.splice(0, overflow);
      pump.bufferStartIndex += overflow;
    }
    return;
  }
  const dropCount = safe - pump.bufferStartIndex;
  if (dropCount <= 0) {
    return;
  }
  pump.buffer.splice(0, dropCount);
  pump.bufferStartIndex += dropCount;
}
