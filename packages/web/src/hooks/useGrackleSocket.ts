import { useState, useEffect, useCallback, useRef } from "react";

export interface Environment {
  id: string;
  displayName: string;
  adapterType: string;
  defaultRuntime: string;
  status: string;
  bootstrapped: boolean;
}

export interface Session {
  id: string;
  envId: string;
  runtime: string;
  status: string;
  prompt: string;
  startedAt: string;
}

export interface SessionEvent {
  sessionId: string;
  eventType: string;
  timestamp: string;
  content: string;
}

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
}

export function useGrackleSocket(url?: string) {
  const wsUrl = url || (typeof window !== "undefined"
    ? `ws://${window.location.hostname}:3000`
    : "ws://localhost:3000");

  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [lastSpawnedId, setLastSpawnedId] = useState<string | null>(null);

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        send({ type: "list_environments" });
        send({ type: "list_sessions" });
        send({ type: "subscribe_all" });
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as WsMessage;
        switch (msg.type) {
          case "environments":
            setEnvironments((msg.payload?.environments as Environment[]) || []);
            break;
          case "sessions":
            setSessions((msg.payload?.sessions as Session[]) || []);
            break;
          case "session_event": {
            const event = msg.payload as unknown as SessionEvent;
            setEvents((prev) => [...prev, event]);
            // Update session status when status events arrive
            if (event.eventType === "status") {
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === event.sessionId
                    ? { ...s, status: event.content }
                    : s
                )
              );
            }
            break;
          }
          case "spawned": {
            const spawnedId = msg.payload?.sessionId as string;
            if (spawnedId) setLastSpawnedId(spawnedId);
            send({ type: "list_sessions" });
            break;
          }
          case "error":
            console.error("[ws]", msg.payload?.message);
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [wsUrl, send]);

  const spawn = useCallback(
    (envId: string, prompt: string, model?: string, runtime?: string) => {
      send({
        type: "spawn",
        payload: { envId, prompt, model: model || "", runtime: runtime || "" },
      });
    },
    [send]
  );

  const sendInput = useCallback(
    (sessionId: string, text: string) => {
      send({ type: "send_input", payload: { sessionId, text } });
    },
    [send]
  );

  const kill = useCallback(
    (sessionId: string) => {
      send({ type: "kill", payload: { sessionId } });
    },
    [send]
  );

  const refresh = useCallback(() => {
    send({ type: "list_environments" });
    send({ type: "list_sessions" });
  }, [send]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    connected,
    environments,
    sessions,
    events,
    lastSpawnedId,
    spawn,
    sendInput,
    kill,
    refresh,
    clearEvents,
  };
}
