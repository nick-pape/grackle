/**
 * Domain hook for session management.
 *
 * Uses ConnectRPC for CRUD operations (list, spawn, kill, events, task sessions).
 * Real-time session events still flow via WebSocket (subscribe_all push).
 *
 * @module
 */

import { useState, useCallback } from "react";
import { MAX_EVENTS, isSessionEvent, mapEndReason, mapSessionStatus, warnBadPayload } from "@grackle-ai/web-components";
import type { Session, SessionEvent, WsMessage, UseSessionsResult } from "@grackle-ai/web-components";
import { grackleClient } from "./useGrackleClient.js";
import { protoToSession, protoToSessionEvent } from "./proto-converters.js";
import { useLoadingState } from "./useLoadingState.js";

export type { UseSessionsResult } from "@grackle-ai/web-components";

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
  const { loading: sessionsLoading, track: trackSessions } = useLoadingState();
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [eventsDropped, setEventsDropped] = useState<number>(0);
  const [lastSpawnedId, setLastSpawnedId] = useState<string | undefined>(
    undefined,
  );
  const [taskSessions, setTaskSessions] = useState<Record<string, Session[]>>({});

  /** Fetch the session list from the server via ConnectRPC. */
  const loadSessions = useCallback(async () => {
    try {
      const resp = await trackSessions(grackleClient.listSessions({}));
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
    } catch {
      // empty
    }
  }, [trackSessions]);

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

  /** Handle a session event directly from ConnectRPC StreamEvents. */
  const handleSessionEvent = useCallback((event: SessionEvent): void => {
    handleMessage({ type: "session_event", payload: event as unknown as Record<string, unknown> });
  }, [handleMessage]);

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
        loadSessions().catch(() => {});
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
    async (
      environmentId: string,
      prompt: string,
      personaId?: string,
      workingDirectory?: string,
    ) => {
      try {
        const session = await grackleClient.spawnAgent({
          environmentId,
          prompt,
          personaId: personaId || "",
          workingDirectory: workingDirectory || "",
        });
        setLastSpawnedId(session.id);
        await loadSessions();
      } catch {
        // empty
      }
    },
    [loadSessions],
  );

  const sendInput = useCallback(
    async (sessionId: string, text: string) => {
      try {
        await grackleClient.sendInput({ sessionId, text });
      } catch {
        // empty
      }
    },
    [],
  );

  const kill = useCallback(
    async (sessionId: string) => {
      try {
        await grackleClient.killAgent({ id: sessionId, graceful: false });
      } catch {
        // empty
      }
    },
    [],
  );

  const stopGraceful = useCallback(
    async (sessionId: string) => {
      try {
        await grackleClient.killAgent({ id: sessionId, graceful: true });
      } catch {
        // empty
      }
    },
    [],
  );

  const loadSessionEvents = useCallback(
    async (sessionId: string) => {
      try {
        const resp = await grackleClient.getSessionEvents({ id: sessionId });
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
      } catch {
        // empty
      }
    },
    [],
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
    setEventsDropped(0);
  }, []);

  const loadTaskSessions = useCallback(
    async (taskId: string) => {
      try {
        const resp = await grackleClient.getTaskSessions({ id: taskId });
        const sessionsArr = resp.sessions.map(protoToSession);
        setTaskSessions((prev) => ({ ...prev, [taskId]: sessionsArr }));
      } catch {
        // empty
      }
    },
    [],
  );

  return {
    sessions,
    sessionsLoading,
    events,
    eventsDropped,
    lastSpawnedId,
    taskSessions,
    loadSessions,
    spawn,
    sendInput,
    kill,
    stopGraceful,
    loadSessionEvents,
    clearEvents,
    loadTaskSessions,
    handleMessage,
    handleSessionEvent,
    handleLegacyMessage,
  };
}
