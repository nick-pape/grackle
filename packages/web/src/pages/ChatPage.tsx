import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { ROOT_TASK_ID } from "@grackle-ai/common";
import { useGrackle } from "../context/GrackleContext.js";
import { useToast } from "../context/ToastContext.js";
import { EventStream } from "../components/display/EventStream.js";
import { ChatInput } from "../components/chat/index.js";
import { SplitButton } from "../components/display/index.js";
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
    loadTaskSessions, loadSessionEvents, kill, stopGraceful,
    taskSessions,
    sendInput, spawn, startTask, personas, provisionEnvironment,
  } = useGrackle();
  const { showToast } = useToast();

  const loadedSessionRef = useRef<string | undefined>(undefined);
  const [pendingMessage, setPendingMessage] = useState<string | undefined>();

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
    && latestSession.status !== "stopped" && latestSession.status !== "suspended";

  const isSessionIdle = latestSession?.status === "idle";

  // Auto-send pending message once the session becomes idle.
  // The user's text is queued by handleStartTask and delivered via sendInput
  // so the first user message is always a follow-up, not baked into the prompt.
  useEffect(() => {
    if (pendingMessage && latestSession && isSessionIdle) {
      sendInput(latestSession.id, pendingMessage);
      setPendingMessage(undefined);
    }
  }, [pendingMessage, isSessionIdle, latestSession?.id, sendInput]);

  // Intercept start-mode submissions: start the root task without the user's
  // text (the server uses a hardcoded initial prompt) and queue the text for
  // sendInput once the session is up.
  const handleStartTask = useCallback(
    (taskId: string, personaId?: string, environmentId?: string, text?: string) => {
      if (text) {
        setPendingMessage(text);
      }
      startTask(taskId, personaId, environmentId);
    },
    [startTask],
  );

  return (
    <div className={styles.panelContainer} data-testid="chat-page">
      {isSessionActive && (
        <div className={styles.chatHeader}>
          <span className={styles.chatHeaderInfo}>
            Session: {latestSession!.id.slice(0, 8)} | {latestSession!.runtime} | {latestSession!.status}
          </span>
          <SplitButton
            label="Stop"
            onClick={() => stopGraceful(latestSession!.id)}
            variant="danger"
            size="sm"
            data-testid="stop-split-button"
            options={[
              { label: "Stop", description: "Graceful shutdown", onClick: () => stopGraceful(latestSession!.id) },
              { label: "Kill", description: "Force kill", onClick: () => kill(latestSession!.id) },
            ]}
          />
        </div>
      )}
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
          personas={personas}
          environments={environments}
          onSendInput={sendInput}
          onSpawn={spawn}
          onStartTask={startTask}
          onProvisionEnvironment={provisionEnvironment}
          onShowToast={showToast}
        />
      )}
      {localEnvironment && !isSessionActive && (
        <ChatInput
          mode="start"
          taskId={ROOT_TASK_ID}
          environmentId={localEnvironment.id}
          personas={personas}
          environments={environments}
          onSendInput={sendInput}
          onSpawn={spawn}
          onStartTask={handleStartTask}
          onProvisionEnvironment={provisionEnvironment}
          onShowToast={showToast}
        />
      )}
    </div>
  );
}
