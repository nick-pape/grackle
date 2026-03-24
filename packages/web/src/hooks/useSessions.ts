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
  mapEndReason,
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
  /** Handle legacy WS messages injected by E2E tests. */
  handleLegacyMessage?: (msg: WsMessage) => boolean;
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
          // Preserve real-time status/endReason updates that may be more recent
          const prevMap = new Map(prev.map((s) => [s.id, s]));
          return incoming.map((s) => {
            const prevSession = prevMap.get(s.id);
            const prevStatus = prevSession?.status;
            if (!prevStatus || prevStatus === s.status) {
              return s;
            }
            if (TERMINAL_STATUSES.has(prevStatus) && ACTIVE_STATUSES.has(s.status)) {
              return { ...s, status: prevStatus, ...(prevSession.endReason !== undefined ? { endReason: prevSession.endReason } : {}) };
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
      () => {},
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
      const endReason = mapEndReason(event.content);
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === event.sessionId);
        if (exists) {
          return prev.map((s) =>
            s.id === event.sessionId
              ? { ...s, status: mappedStatus, ...(endReason !== undefined ? { endReason } : {}) }
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
            ...(endReason !== undefined ? { endReason } : {}),
          },
        ];
      });
    }
    return true;
  }, []);

  const handleLegacyMessage = useCallback((msg: WsMessage): boolean => {
    switch (msg.type) {
      case "sessions": {
        const incoming = Array.isArray(msg.payload?.sessions) ? msg.payload.sessions as Session[] : [];
        setSessions(incoming);
        return true;
      }
      case "spawned": {
        const spawnedId = msg.payload?.sessionId;
        if (typeof spawnedId === "string" && spawnedId) {
          setLastSpawnedId(spawnedId);
        }
        loadSessions();
        return true;
      }
      case "session_events": {
        // Legacy replay — just set events directly
        const replayEvents = Array.isArray(msg.payload?.events) ? msg.payload.events as SessionEvent[] : [];
        if (replayEvents.length > 0) {
          setEvents(replayEvents);
        }
        return true;
      }
      case "task_sessions": {
        const taskId = msg.payload?.taskId;
        if (typeof taskId === "string" && taskId) {
          const sessionsArr = Array.isArray(msg.payload?.sessions) ? msg.payload.sessions as Session[] : [];
          setTaskSessions((prev) => ({ ...prev, [taskId]: sessionsArr }));
        }
        return true;
      }
      default:
        return false;
    }
  }, [loadSessions]);

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
        () => {},
      );
    },
    [loadSessions],
  );

  const sendInput = useCallback(
    (sessionId: string, text: string) => {
      grackleClient.sendInput({ sessionId, text }).catch(
        () => {},
      );
    },
    [],
  );

  const kill = useCallback(
    (sessionId: string) => {
      grackleClient.killAgent({ id: sessionId }).catch(
        () => {},
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
        () => {},
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
        () => {},
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
    handleLegacyMessage,
  };
}
