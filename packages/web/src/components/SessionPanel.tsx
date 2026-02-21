import { useGrackle } from "../context/GrackleContext.js";
import { EventRenderer } from "./EventRenderer.js";
import { useEffect, useRef } from "react";
import type { ViewMode } from "../App.js";
import type { Session, SessionEvent } from "../hooks/useGrackleSocket.js";

interface Props {
  viewMode: ViewMode;
}

// --- Subcomponents ---

interface SessionHeaderProps {
  sessionId: string;
  session: Session | null;
  isActive: boolean;
  onKill: (sessionId: string) => void;
}

function SessionHeader({ sessionId, session, isActive, onKill }: SessionHeaderProps) {
  return (
    <div
      style={{
        padding: "6px 12px",
        borderBottom: "1px solid #0f3460",
        fontSize: "12px",
        color: "#a0a0a0",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span>
        Session: {sessionId.slice(0, 8)}
        {session && ` | ${session.runtime} | ${session.status}`}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {session && (
          <span>{session.prompt.length > 60 ? session.prompt.slice(0, 60) + "..." : session.prompt}</span>
        )}
        {isActive && (
          <button
            onClick={() => onKill(sessionId)}
            title="Stop session"
            style={{
              background: "none",
              border: "1px solid #e94560",
              color: "#e94560",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "11px",
              padding: "1px 6px",
              fontFamily: "monospace",
            }}
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

interface EventListProps {
  sessionEvents: SessionEvent[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

function EventList({ sessionEvents, scrollRef }: EventListProps) {
  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflow: "auto",
        padding: "12px",
      }}
    >
      {sessionEvents.length === 0 && (
        <div style={{ color: "#666" }}>Waiting for events...</div>
      )}
      {sessionEvents.map((event, i) => (
        <EventRenderer key={i} event={event} />
      ))}
    </div>
  );
}

// --- Main component ---

export function SessionPanel({ viewMode }: Props) {
  const { events, sessions, loadSessionEvents, kill } = useGrackle();
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<string | null>(null);

  const sessionId = viewMode.kind === "session" ? viewMode.sessionId : null;

  const sessionEvents = sessionId
    ? events.filter((e) => e.sessionId === sessionId)
    : [];

  const session = sessionId
    ? sessions.find((s) => s.id === sessionId) ?? null
    : null;

  // Load historical events when selecting a session with no in-memory events
  useEffect(() => {
    if (sessionId && sessionId !== loadedRef.current) {
      loadedRef.current = sessionId;
      loadSessionEvents(sessionId);
    }
  }, [sessionId, loadSessionEvents]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessionEvents.length]);

  // --- empty mode ---
  if (viewMode.kind === "empty") {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#666",
        }}
      >
        Select a session or click + to start
      </div>
    );
  }

  // --- new_chat mode ---
  if (viewMode.kind === "new_chat") {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#666",
        }}
      >
        Enter a prompt below to start a new session
      </div>
    );
  }

  // --- session mode ---
  const isActive = session?.status === "running" || session?.status === "waiting_input";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <SessionHeader
        sessionId={sessionId!}
        session={session}
        isActive={isActive}
        onKill={kill}
      />
      <EventList
        sessionEvents={sessionEvents}
        scrollRef={scrollRef}
      />
    </div>
  );
}
