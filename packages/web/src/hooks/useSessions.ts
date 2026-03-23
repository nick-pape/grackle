/**
 * Domain hook for session management.
 *
 * Uses ConnectRPC for CRUD operations (list, spawn, kill, events, task sessions).
 * Real-time session events still flow via WebSocket (subscribe_all push).
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { Session, SessionEvent, WsMessage } from "./types.js";
import {
  isSessionEvent,
  warnBadPayload,
  mapSessionStatus,
  MAX_EVENTS,
} from "./types.js";
import { grackleClient } from "./useGrackleClient.js";
import { protoToSession, protoToSessionEvent } from "./proto-converters.js";

/** Values returned by {@link useSessions}. */
export interface UseSessionsResult {
  /** All known sessions. */
  sessions: Session[];
  /** Session events currently loaded in memory. */
  events: SessionEvent[];
  /**
   * The total number of events that have been silently dropped due to the
   * MAX_EVENTS in-memory cap. A non-zero value means the user is only seeing
   * the most-recent slice of a long session; older events are still available
   * in the server-side JSONL log.
   */
  eventsDropped: number;
  /** The ID of the most recently spawned session, or `undefined`. */
  lastSpawnedId: string | undefined;
  /** Sessions grouped by task ID. */
  taskSessions: Record<string, Session[]>;
  /** Refresh the session list from the server. */
  loadSessions: () => void;
  /** Spawn a new session in an environment. */
  spawn: (
    environmentId: string,
    prompt: string,
    personaId?: string,
    worktreeBasePath?: string,
  ) => void;
  /** Send text input to a running session. */
  sendInput: (sessionId: string, text: string) => void;
  /** Kill a running session. */
  kill: (sessionId: string) => void;
  /** Load stored events for a session from the server. */
  loadSessionEvents: (sessionId: string) => void;
  /** Clear all in-memory events and reset the drop counter. */
  clearEvents: () => void;
  /** Load sessions associated with a task. */
  loadTaskSessions: (taskId: string) => void;
  /**
   * Handle an incoming WebSocket message. Returns `true` if handled.
   * Only handles real-time `session_event` push messages from subscribe_all.
   */
  handleMessage: (msg: WsMessage) => boolean;
}

/** Set of session statuses considered active. */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["pending", "running", "idle"]);
/** Set of session statuses considered terminal. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "interrupted", "hibernating", "suspended"]);
/** Ordered list of active statuses from least to most progressed. */
const ACTIVE_ORDER: readonly string[] = ["pending", "running", "idle"];

/**
 * Hook that manages session state, events, and session lifecycle actions.
 *
 * @returns Session state, actions, and a message handler for real-time events.
 */
export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [eventsDropped, setEventsDropped] = useState<number>(0);
  const [lastSpawnedId, setLastSpawnedId] = useState<string | undefined>(
    undefined,
  );
  const [taskSessions, setTaskSessions] = useState<Record<string, Session[]>>({});

  /** Fetch the session list from the server via ConnectRPC. */
  const loadSessions = useCallback(() => {
    grackleClient.listSessions({}).then(
      (resp) => {
        const incoming = resp.sessions.map(protoToSession);
        setSessions((prev) => {
          // Preserve real-time status updates that may be more recent
          const prevMap = new Map(prev.map((s) => [s.id, s.status]));
          return incoming.map((s) => {
            const prevStatus = prevMap.get(s.id);
            if (!prevStatus || prevStatus === s.status) {
              return s;
            }
            if (TERMINAL_STATUSES.has(prevStatus) && ACTIVE_STATUSES.has(s.status)) {
              return { ...s, status: prevStatus };
            }
            if (ACTIVE_STATUSES.has(prevStatus) && ACTIVE_STATUSES.has(s.status)) {
              if (ACTIVE_ORDER.indexOf(prevStatus) > ACTIVE_ORDER.indexOf(s.status)) {
                return { ...s, status: prevStatus };
              }
            }
            return s;
          });
        });
      },
      (err) => { console.error("[grpc] listSessions failed:", err); },
    );
  }, []);

  /**
   * Handle real-time session_event push messages from subscribe_all.
   * This is the only WS message type still handled by this hook.
   */
  const handleMessage = useCallback((msg: WsMessage): boolean => {
    if (msg.type !== "session_event") {
      return false;
    }

    if (!isSessionEvent(msg.payload)) {
      warnBadPayload("session_event", "payload is not a valid SessionEvent");
      return true;
    }
    const event: SessionEvent = msg.payload;
    let dropped = 0;
    setEvents((prev) => {
      const next = [...prev, event];
      if (next.length > MAX_EVENTS) {
        dropped = next.length - MAX_EVENTS;
        return next.slice(-MAX_EVENTS);
      }
      return next;
    });
    if (dropped > 0) {
      setEventsDropped((n) => n + dropped);
    }
    // Update session usage when a usage event streams in
    if (event.eventType === "usage") {
      try {
        const data = JSON.parse(event.content) as Record<string, unknown>;
        const inputTokens = Number(data.input_tokens) || 0;
        const outputTokens = Number(data.output_tokens) || 0;
        const costUsd = Number(data.cost_usd) || 0;
        if (inputTokens > 0 || outputTokens > 0 || costUsd > 0) {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === event.sessionId
                ? {
                    ...s,
                    inputTokens: (s.inputTokens ?? 0) + inputTokens,
                    outputTokens: (s.outputTokens ?? 0) + outputTokens,
                    costUsd: (s.costUsd ?? 0) + costUsd,
                  }
                : s,
            ),
          );
        }
      } catch { /* ignore malformed usage events */ }
    }
    if (event.eventType === "status") {
      const mappedStatus = mapSessionStatus(event.content);
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === event.sessionId);
        if (exists) {
          return prev.map((s) =>
            s.id === event.sessionId
              ? { ...s, status: mappedStatus }
              : s,
          );
        }
        return [
          ...prev,
          {
            id: event.sessionId,
            environmentId: "",
            runtime: "",
            status: mappedStatus,
            prompt: "",
            startedAt: event.timestamp,
          },
        ];
      });
    }
    return true;
  }, []);

  const spawn = useCallback(
    (
      environmentId: string,
      prompt: string,
      personaId?: string,
      worktreeBasePath?: string,
    ) => {
      grackleClient.spawnAgent({
        environmentId,
        prompt,
        personaId: personaId || "",
        worktreeBasePath: worktreeBasePath || "",
      }).then(
        (session) => {
          setLastSpawnedId(session.id);
          loadSessions();
        },
        (err) => { console.error("[grpc] spawnAgent failed:", err); },
      );
    },
    [loadSessions],
  );

  const sendInput = useCallback(
    (sessionId: string, text: string) => {
      grackleClient.sendInput({ sessionId, text }).catch(
        (err) => { console.error("[grpc] sendInput failed:", err); },
      );
    },
    [],
  );

  const kill = useCallback(
    (sessionId: string) => {
      grackleClient.killAgent({ id: sessionId }).catch(
        (err) => { console.error("[grpc] killAgent failed:", err); },
      );
    },
    [],
  );

  const loadSessionEvents = useCallback(
    (sessionId: string) => {
      grackleClient.getSessionEvents({ id: sessionId }).then(
        (resp) => {
          const replayEvents = resp.events.map(protoToSessionEvent);
          if (replayEvents.length > 0) {
            let replayDropped = 0;
            setEvents((prev) => {
              const existingKeys = new Set<string>();
              for (const e of prev) {
                if (e.sessionId === sessionId) {
                  existingKeys.add(`${e.timestamp}|${e.eventType}`);
                }
              }
              const newFromReplay = replayEvents.filter(
                (e) => !existingKeys.has(`${e.timestamp}|${e.eventType}`),
              );
              const merged = [...prev, ...newFromReplay].sort(
                (a, b) => {
                  if (a.sessionId !== b.sessionId) {
                    return 0;
                  }
                  return a.timestamp.localeCompare(b.timestamp);
                },
              );
              if (merged.length > MAX_EVENTS) {
                replayDropped = merged.length - MAX_EVENTS;
                return merged.slice(-MAX_EVENTS);
              }
              return merged;
            });
            if (replayDropped > 0) {
              setEventsDropped((n) => n + replayDropped);
            }
          }
        },
        (err) => { console.error("[grpc] getSessionEvents failed:", err); },
      );
    },
    [],
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
    setEventsDropped(0);
  }, []);

  const loadTaskSessions = useCallback(
    (taskId: string) => {
      grackleClient.getTaskSessions({ id: taskId }).then(
        (resp) => {
          const sessionsArr = resp.sessions.map(protoToSession);
          setTaskSessions((prev) => ({ ...prev, [taskId]: sessionsArr }));
        },
        (err) => { console.error("[grpc] getTaskSessions failed:", err); },
      );
    },
    [],
  );

  return {
    sessions,
    events,
    eventsDropped,
    lastSpawnedId,
    taskSessions,
    loadSessions,
    spawn,
    sendInput,
    kill,
    loadSessionEvents,
    clearEvents,
    loadTaskSessions,
    handleMessage,
  };
}
