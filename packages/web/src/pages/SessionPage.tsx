import { useEffect, useMemo, useRef, type JSX } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { EventStream } from "../components/display/EventStream.js";
import { ChatInput } from "../components/chat/index.js";
import { Breadcrumbs } from "../components/display/index.js";
import { buildSessionBreadcrumbs } from "../utils/breadcrumbs.js";
import type { Session } from "../hooks/useGrackleSocket.js";
import { groupConsecutiveTextEvents, pairToolEvents } from "../utils/sessionEvents.js";
import { formatTokens, formatCost } from "../utils/format.js";
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
        {(session?.inputTokens || session?.outputTokens || session?.costUsd)
          ? ` | ${formatTokens((session!.inputTokens ?? 0) + (session!.outputTokens ?? 0))} tokens · ${formatCost(session!.costUsd ?? 0)}`
          : ""}
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

/** Empty-state message for session streams. */
function SessionEmptyState({ session }: { session: Session | undefined }): JSX.Element {
  const isTerminal = session && (
    ["hibernating", "suspended"].includes(session.status)
    || (session.status === "idle" && !!session.endReason)
  );
  const emptyMessage = isTerminal
    ? `Session ${session.status} with no events recorded.`
    : "Waiting for events...";
  return (
    <div className={isTerminal ? styles.errorMessage : styles.waitingMessage}>{emptyMessage}</div>
  );
}

/** Page for viewing a session's event stream. */
export function SessionPage(): JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  const {
    events, eventsDropped, sessions, kill, loadSessionEvents,
  } = useGrackle();
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
      <EventStream
        events={groupedEvents}
        eventsDropped={eventsDropped}
        emptyState={<SessionEmptyState session={session} />}
      />
      {isActive && (
        <ChatInput
          mode="send"
          sessionId={sessionId}
          environmentId={session!.environmentId}
          showStop
          onSessionKill={() => kill(sessionId)}
        />
      )}
    </div>
  );
}
