import { useGrackle } from "../context/GrackleContext.js";
import { EventRenderer } from "./EventRenderer.js";
import { InputBar } from "./InputBar.js";
import { useEffect, useRef } from "react";

interface Props {
  sessionId: string | null;
}

export function SessionPanel({ sessionId }: Props) {
  const { events, sessions } = useGrackle();
  const scrollRef = useRef<HTMLDivElement>(null);

  const sessionEvents = sessionId
    ? events.filter((e) => e.sessionId === sessionId)
    : [];

  const session = sessionId
    ? sessions.find((s) => s.id === sessionId)
    : null;

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessionEvents.length]);

  if (!sessionId) {
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
        Select a session or spawn a new agent
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Session header */}
      <div
        style={{
          padding: "6px 12px",
          borderBottom: "1px solid #0f3460",
          fontSize: "12px",
          color: "#a0a0a0",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          Session: {sessionId.slice(0, 8)}
          {session && ` | ${session.runtime} | ${session.status}`}
        </span>
        {session && (
          <span>{session.prompt.length > 60 ? session.prompt.slice(0, 60) + "..." : session.prompt}</span>
        )}
      </div>

      {/* Event stream */}
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

      {/* Input bar */}
      {session?.status === "waiting_input" && (
        <InputBar sessionId={sessionId} />
      )}
    </div>
  );
}
