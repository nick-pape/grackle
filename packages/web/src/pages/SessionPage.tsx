import { useEffect, useMemo, useRef, type JSX, type RefObject } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { EventRenderer } from "../components/display/EventRenderer.js";
import { Breadcrumbs } from "../components/display/index.js";
import { buildSessionBreadcrumbs } from "../utils/breadcrumbs.js";
import type { Session } from "../hooks/useGrackleSocket.js";
import { groupConsecutiveTextEvents, pairToolEvents, type DisplayEvent } from "../utils/sessionEvents.js";
import styles from "../components/panels/SessionPanel.module.scss";

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
