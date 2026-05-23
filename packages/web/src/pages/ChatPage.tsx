import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { ROOT_TASK_ID } from "@grackle-ai/common";
import { useGrackle } from "../context/GrackleContext.js";
import { useSandboxProxyUrl } from "../context/ManifestContext.js";
import {
  ChatInput, EventStream, SplitButton,
  groupConsecutiveTextEvents, pairToolEvents, useToast,
} from "@grackle-ai/web-components";
import { ChatShimmer } from "./ChatShimmer.js";
import styles from "./ChatPage.module.scss";

/** Empty state shown when no System session is active. */
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

/**
 * Root page — the root-task conversation with the System orchestrator agent.
 *
 * Strictly the `ROOT_TASK_ID` conversation: input + event stream + Stop/Kill.
 * IPC stream browsing lives on the separate Coordination tab.
 */
export function ChatPage(): JSX.Element {
  const sandboxProxyUrl = useSandboxProxyUrl();
  const {
    tasks: { tasks, tasksLoading, startTask },
    sessions: { sessions, sessionsLoading, events, eventsDropped, taskSessions, loadTaskSessions, loadSessionEvents, kill, stopGraceful, sendInput, spawn },
    environments: { environments, provisionEnvironment },
    personas: { personas },
  } = useGrackle();
  const { showToast } = useToast();

  const loadedSessionRef = useRef<string | undefined>(undefined);
  const [pendingMessage, setPendingMessage] = useState<string | undefined>();

  const rootTask = tasks.find((t) => t.id === ROOT_TASK_ID);
  const latestSession = rootTask?.latestSessionId
    ? (sessions.find((s) => s.id === rootTask.latestSessionId) ??
       (taskSessions[ROOT_TASK_ID] ?? []).find((s) => s.id === rootTask.latestSessionId))
    : undefined;

  // Load root task sessions on mount and whenever the latest session changes.
  useEffect(() => {
    loadTaskSessions(ROOT_TASK_ID).catch(() => {});
  }, [loadTaskSessions]);

  useEffect(() => {
    if (rootTask?.latestSessionId) {
      loadTaskSessions(ROOT_TASK_ID).catch(() => {});
    }
  }, [rootTask?.latestSessionId, loadTaskSessions]);

  // Load events once the session is known.
  useEffect(() => {
    if (latestSession && latestSession.id !== loadedSessionRef.current) {
      loadedSessionRef.current = latestSession.id;
      loadSessionEvents(latestSession.id).catch(() => {});
    }
  }, [latestSession?.id, loadSessionEvents]);

  const groupedEvents = useMemo(() => {
    if (!latestSession) {
      return [];
    }
    const filtered = events.filter((e) => e.sessionId === latestSession.id);
    return pairToolEvents(groupConsecutiveTextEvents(filtered));
  }, [events, latestSession?.id]);

  const localEnvironment = environments.find(
    (e) => e.adapterType === "local" && e.status === "connected",
  );

  const isSessionActive = latestSession !== undefined
    && latestSession.status !== "stopped" && latestSession.status !== "suspended";
  const isSessionIdle = latestSession?.status === "idle";

  useEffect(() => {
    if (pendingMessage && latestSession && isSessionIdle) {
      sendInput(latestSession.id, pendingMessage).catch(() => { showToast("Failed to send message", "error"); });
      setPendingMessage(undefined);
    }
  }, [pendingMessage, isSessionIdle, latestSession?.id, sendInput, showToast]);

  const handleStartTask = useCallback(
    (taskId: string, personaId?: string, environmentId?: string, text?: string) => {
      if (text) {
        setPendingMessage(text);
      }
      startTask(taskId, personaId, environmentId).catch(() => {});
    },
    [startTask],
  );

  if (!rootTask && (sessionsLoading || tasksLoading)) {
    return <ChatShimmer />;
  }

  // Root task exists with a session, but its data hasn't resolved yet — show the
  // shimmer rather than the empty/start state (which could start a duplicate
  // root session while one is already loading).
  if (rootTask?.latestSessionId && sessionsLoading && !latestSession) {
    return <ChatShimmer />;
  }

  return (
    <div className={styles.panelContainer} data-testid="chat-page">
      {isSessionActive && (
        <div className={styles.chatHeader}>
          <span className={styles.chatHeaderInfo}>
            Session: {latestSession!.id.slice(0, 8)} | {latestSession!.runtime} | {latestSession!.status}
          </span>
          <div className={styles.chatHeaderActions}>
            <SplitButton
              label="Stop"
              onClick={() => { stopGraceful(latestSession!.id).catch(() => {}); }}
              variant="danger"
              size="sm"
              data-testid="stop-split-button"
              options={[
                { label: "Stop", description: "Graceful shutdown", onClick: () => { stopGraceful(latestSession!.id).catch(() => {}); } },
                { label: "Kill", description: "Force kill", onClick: () => { kill(latestSession!.id).catch(() => {}); } },
              ]}
            />
          </div>
        </div>
      )}

      <EventStream
        events={groupedEvents}
        eventsDropped={eventsDropped}
        sandboxProxyUrl={sandboxProxyUrl}
        emptyState={<ChatEmptyState hasLocalEnvironment={!!localEnvironment} />}
        onShowToast={showToast}
      />

      {/* Single ChatInput instance so typed text survives isSessionActive flips */}
      {localEnvironment && (
        <ChatInput
          mode={isSessionActive ? "send" : "start"}
          sessionId={isSessionActive ? latestSession!.id : undefined}
          taskId={ROOT_TASK_ID}
          environmentId={isSessionActive ? latestSession!.environmentId : localEnvironment.id}
          personas={personas}
          environments={environments}
          onSendInput={(sid, text) => { sendInput(sid, text).catch(() => { showToast("Failed to send message", "error"); }); }}
          onSpawn={(eid, prompt, pid) => { spawn(eid, prompt, pid).catch(() => {}); }}
          onStartTask={handleStartTask}
          onProvisionEnvironment={(eid) => { provisionEnvironment(eid).catch(() => {}); }}
          onShowToast={showToast}
        />
      )}
    </div>
  );
}
