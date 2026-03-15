import { useEffect, useMemo, useRef, type JSX, type RefObject } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { EventRenderer } from "../components/display/EventRenderer.js";
import { Breadcrumbs } from "../components/display/index.js";
import { buildSessionBreadcrumbs } from "../utils/breadcrumbs.js";
import type { Session, SessionEvent } from "../hooks/useGrackleSocket.js";
import styles from "../components/panels/SessionPanel.module.scss";

/** Session event augmented with optional tool_use context for paired tool results. */
type DisplayEvent = SessionEvent & { toolUseCtx?: { tool: string; args: unknown } };

/**
 * Merges consecutive "text" events into single entries with concatenated content.
 */
function groupConsecutiveTextEvents(events: SessionEvent[]): SessionEvent[] {
  const result: SessionEvent[] = [];
  for (const event of events) {
    const previous = result[result.length - 1];
    if (event.eventType === "text" && previous?.eventType === "text") {
      result[result.length - 1] = { ...previous, content: previous.content + event.content };
    } else {
      result.push(event);
    }
  }
  return result;
}

/**
 * Pairs tool_use events with their tool_result counterparts.
 */
function pairToolEvents(events: SessionEvent[]): DisplayEvent[] {
  const parsedRaw = new Map<SessionEvent, Record<string, unknown>>();
  for (const e of events) {
    if (!e.raw) continue;
    try {
      parsedRaw.set(e, JSON.parse(e.raw) as Record<string, unknown>);
    } catch { /* skip unparseable events */ }
  }

  const toolUseById = new Map<string, { tool: string; args: unknown }>();
  for (const e of events) {
    if (e.eventType !== "tool_use") continue;
    const raw = parsedRaw.get(e);
    if (!raw || typeof raw.id !== "string") continue;
    try {
      const content = JSON.parse(e.content) as { tool: string; args: unknown };
      toolUseById.set(raw.id, { tool: content.tool ?? "", args: content.args });
    } catch { /* skip unparseable events */ }
  }

  const consumedIds = new Set<string>();
  const display: DisplayEvent[] = events.map((e) => {
    if (e.eventType !== "tool_result") return e;
    const raw = parsedRaw.get(e);
    if (!raw || typeof raw.tool_use_id !== "string") return e;
    const ctx = toolUseById.get(raw.tool_use_id);
    if (!ctx) return e;
    consumedIds.add(raw.tool_use_id);
    return { ...e, toolUseCtx: ctx };
  });

  return display.filter((e) => {
    if (e.eventType !== "tool_use") return true;
    const raw = parsedRaw.get(e);
    if (raw && typeof raw.id === "string") return !consumedIds.has(raw.id);
    return true;
  });
}

/** Props for the SessionHeader subcomponent. */
interface SessionHeaderProps {
  sessionId: string;
  session: Session | undefined;
  isActive: boolean;
  onKill: (sessionId: string) => void;
}

/** Displays session metadata and a kill button for active sessions. */
function SessionHeader({ sessionId, session, isActive, onKill }: SessionHeaderProps): JSX.Element {
  return (
    <div className={styles.header}>
      <span>
        Session: {sessionId.slice(0, 8)}
        {session && ` | ${session.runtime} | ${session.status}`}
      </span>
      <span className={styles.headerInfo}>
        {session && (
          <span>{session.prompt.length > 60 ? session.prompt.slice(0, 60) + "..." : session.prompt}</span>
        )}
        {isActive && (
          <button
            onClick={() => onKill(sessionId)}
            title="Stop session"
            className={styles.killButton}
          >
            {"\u00D7"}
          </button>
        )}
      </span>
    </div>
  );
}

/** Overflow warning banner shown when events exceed the in-memory cap. */
function EventOverflowBanner({ eventsDropped }: { eventsDropped: number }): JSX.Element {
  if (eventsDropped <= 0) {
    return <></>;
  }
  return (
    <div className={styles.eventOverflowWarning} role="alert">
      ⚠ {eventsDropped.toLocaleString()} older event{eventsDropped === 1 ? "" : "s"} were dropped — only the most recent 5,000 are shown. Full history is available in the session log.
    </div>
  );
}

/** Props for the EventList subcomponent. */
interface EventListProps {
  sessionEvents: DisplayEvent[];
  session: Session | undefined;
  eventsDropped: number;
  // eslint-disable-next-line @rushstack/no-new-null
  scrollRef: RefObject<HTMLDivElement | null>;
}

/** Scrollable list of session events with empty-state messaging. */
function EventList({ sessionEvents, session, eventsDropped, scrollRef }: EventListProps): JSX.Element {
  const isTerminal = session && ["completed", "failed", "interrupted"].includes(session.status);
  const emptyMessage = isTerminal
    ? `Session ${session.status} with no events recorded.`
    : "Waiting for events...";

  return (
    <div ref={scrollRef} className={styles.eventScroll}>
      {sessionEvents.length === 0 && (
        <div className={isTerminal ? styles.errorMessage : styles.waitingMessage}>{emptyMessage}</div>
      )}
      <EventOverflowBanner eventsDropped={eventsDropped} />
      {sessionEvents.map((event, i) => (
        <EventRenderer key={`${event.sessionId}-${event.timestamp}-${i}`} event={event} toolUseCtx={event.toolUseCtx} />
      ))}
    </div>
  );
}

/** Page for viewing a session's event stream. */
export function SessionPage(): JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  const {
    events, eventsDropped, sessions, kill, loadSessionEvents,
  } = useGrackle();
  // eslint-disable-next-line @rushstack/no-new-null
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<string | undefined>(undefined);

  const breadcrumbs = buildSessionBreadcrumbs(sessionId!);

  const session = sessions.find((s) => s.id === sessionId) ?? undefined;

  const groupedEvents = useMemo(() => {
    const filtered = sessionId
      ? events.filter((e) => e.sessionId === sessionId)
      : [];
    return pairToolEvents(groupConsecutiveTextEvents(filtered));
  }, [events, sessionId]);

  // Load historical events when selecting a session
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
  }, [groupedEvents.length]);

  if (!sessionId) {
    return (
      <div className={styles.emptyState}>
        No session selected
      </div>
    );
  }

  const isActive = session?.status === "running" || session?.status === "idle";

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />
      <SessionHeader
        sessionId={sessionId}
        session={session}
        isActive={isActive}
        onKill={kill}
      />
      <EventList
        sessionEvents={groupedEvents}
        session={session}
        eventsDropped={eventsDropped}
        scrollRef={scrollRef}
      />
    </div>
  );
}
