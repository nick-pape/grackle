import { useEffect, useMemo, useRef, type JSX } from "react";
import { useParams } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { Breadcrumbs, ChatInput, EventStream, SplitButton, buildSessionBreadcrumbs, formatCost, formatTokens, groupConsecutiveTextEvents, pairToolEvents, useToast } from "@grackle-ai/web-components";
import type { Session } from "../hooks/useGrackleSocket.js";
import styles from "./page-layout.module.scss";

/** Props for the SessionHeader subcomponent. */
interface SessionHeaderProps {
  sessionId: string;
  session: Session | undefined;
  isActive: boolean;
  onStop: () => void;
  onKill: () => void;
}

/** Displays session metadata and stop/kill controls for active sessions. */
function SessionHeader({ sessionId, session, isActive, onStop, onKill }: SessionHeaderProps): JSX.Element {
  return (
    <div className={styles.header}>
      <span>
        Session: {sessionId.slice(0, 8)}
        {session && ` | ${session.runtime} | ${session.endReason || session.status}`}
        {(session?.inputTokens || session?.outputTokens || session?.costUsd)
          ? ` | ${formatTokens((session!.inputTokens ?? 0) + (session!.outputTokens ?? 0))} tokens · ${formatCost(session!.costUsd ?? 0)}`
          : ""}
      </span>
      <span className={styles.headerInfo}>
        {session && (
          <span>{session.prompt.length > 60 ? session.prompt.slice(0, 60) + "..." : session.prompt}</span>
        )}
        {isActive && (
          <SplitButton
            label="Stop"
            onClick={onStop}
            variant="danger"
            size="sm"
            data-testid="stop-split-button"
            options={[
              { label: "Stop", description: "Graceful shutdown", onClick: onStop },
              { label: "Kill", description: "Force kill", onClick: onKill },
            ]}
          />
        )}
      </span>
    </div>
  );
}

/** Empty-state message for session streams. */
function SessionEmptyState({ session }: { session: Session | undefined }): JSX.Element {
  const isTerminal = session && (session.status === "stopped" || session.status === "suspended");
  const emptyMessage = isTerminal
    ? `Session ${session.endReason || session.status} with no events recorded.`
    : "Waiting for events...";
  return (
    <div className={isTerminal ? styles.errorMessage : styles.waitingMessage}>{emptyMessage}</div>
  );
}

/** Page for viewing a session's event stream. */
export function SessionPage(): JSX.Element {
  const { sessionId } = useParams<{ sessionId: string }>();
  const {
    events, eventsDropped, sessions, kill, stopGraceful, loadSessionEvents,
    sendInput, spawn, startTask, personas, environments, provisionEnvironment,
  } = useGrackle();
  const { showToast } = useToast();
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
        sessionId={sessionId!}
        session={session}
        isActive={isActive}
        onStop={() => stopGraceful(sessionId!)}
        onKill={() => kill(sessionId!)}
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
          personas={personas}
          environments={environments}
          onSendInput={sendInput}
          onSpawn={spawn}
          onStartTask={startTask}
          onProvisionEnvironment={provisionEnvironment}
          onShowToast={showToast}
        />
      )}
    </div>
  );
}
