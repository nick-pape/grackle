import { useEffect, useMemo, useRef, type JSX } from "react";
import { ROOT_TASK_ID } from "@grackle-ai/common";
import { useGrackle } from "../context/GrackleContext.js";
import { EventStream } from "../components/display/EventStream.js";
import { ChatInput } from "../components/chat/index.js";
import { groupConsecutiveTextEvents, pairToolEvents } from "../utils/sessionEvents.js";
import styles from "./ChatPage.module.scss";

/** Empty state shown when no session is active. */
function ChatEmptyState({ hasLocalEnvironment }: { hasLocalEnvironment: boolean }): JSX.Element {
  return (
    <div className={styles.emptyState} data-testid="chat-empty-state">
      <div className={styles.emptyTitle}>Welcome to Grackle</div>
      <div className={styles.emptyDescription}>
        {hasLocalEnvironment
          ? "Type a message below to start chatting with the System agent. It can help you plan work, create tasks, and coordinate agents."
          : "Add a local environment in Settings to start chatting."}
      </div>
      {!hasLocalEnvironment && (
        <div className={styles.emptyHint}>
          Go to Settings &rarr; Environments to add one.
        </div>
      )}
    </div>
  );
}

/** Clean full-page chat experience for the root task. */
export function ChatPage(): JSX.Element {
  const {
    tasks, sessions, events, eventsDropped, environments,
    loadTaskSessions, loadSessionEvents, kill,
    taskSessions,
  } = useGrackle();

  const loadedSessionRef = useRef<string | undefined>(undefined);

  // Find root task + its sessions.
  // Resolve latest session from the already-loaded sessions list first (available
  // immediately), falling back to taskSessions (requires a roundtrip to load).
  const rootTask = tasks.find((t) => t.id === ROOT_TASK_ID);
  const latestSession = rootTask?.latestSessionId
    ? (sessions.find((s) => s.id === rootTask.latestSessionId) ??
       (taskSessions[ROOT_TASK_ID] ?? []).find((s) => s.id === rootTask.latestSessionId))
    : undefined;

  // Load sessions on mount
  useEffect(() => {
    loadTaskSessions(ROOT_TASK_ID);
  }, [loadTaskSessions]);

  // Reload sessions when the root task's latest session changes
  useEffect(() => {
    if (rootTask?.latestSessionId) {
      loadTaskSessions(ROOT_TASK_ID);
    }
  }, [rootTask?.latestSessionId, loadTaskSessions]);

  // Load events when session known
  useEffect(() => {
    if (latestSession && latestSession.id !== loadedSessionRef.current) {
      loadedSessionRef.current = latestSession.id;
      loadSessionEvents(latestSession.id);
    }
  }, [latestSession?.id, loadSessionEvents]);

  // Filter + group events for display
  const groupedEvents = useMemo(() => {
    if (!latestSession) {
      return [];
    }
    const filtered = events.filter((e) => e.sessionId === latestSession.id);
    return pairToolEvents(groupConsecutiveTextEvents(filtered));
  }, [events, latestSession?.id]);

  // Find a local environment for the empty state hint
  const localEnvironment = environments.find(
    (e) => e.adapterType === "local" && e.status === "connected",
  );

  // Determine if the latest session is active (running or idle)
  const isSessionActive = latestSession !== undefined
    && !["completed", "failed", "interrupted", "hibernating"].includes(latestSession.status);

  return (
    <div className={styles.panelContainer} data-testid="chat-page">
      <EventStream
        events={groupedEvents}
        eventsDropped={eventsDropped}
        emptyState={<ChatEmptyState hasLocalEnvironment={!!localEnvironment} />}
      />
      {localEnvironment && isSessionActive && (
        <ChatInput
          mode="send"
          sessionId={latestSession!.id}
          environmentId={latestSession!.environmentId}
          showStop
          onSessionKill={() => kill(latestSession!.id)}
        />
      )}
      {localEnvironment && !isSessionActive && (
        <ChatInput
          mode="start"
          taskId={ROOT_TASK_ID}
          environmentId={localEnvironment.id}
        />
      )}
    </div>
  );
}
