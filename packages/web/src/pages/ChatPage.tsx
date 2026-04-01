import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useParams, Link } from "react-router";
import { ROOT_TASK_ID } from "@grackle-ai/common";
import { useGrackle } from "../context/GrackleContext.js";
import {
  ChatInput, EventStream, SplitButton, StreamDetailPanel,
  groupConsecutiveTextEvents, pairToolEvents, useToast, CHAT_URL,
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

/** Empty state when a stream has no active subscriber session. */
function StreamNoSessionState({ streamName }: { streamName: string }): JSX.Element {
  return (
    <div className={styles.emptyState} data-testid="stream-no-session-state">
      <div className={styles.emptyTitle}>{streamName}</div>
      <div className={styles.emptyDescription}>No active sessions on this stream.</div>
    </div>
  );
}

/** Empty state when a streamId doesn't match any known stream. */
function StreamNotFoundState(): JSX.Element {
  return (
    <div className={styles.emptyState} data-testid="stream-not-found-state">
      <div className={styles.emptyTitle}>Stream not found</div>
      <div className={styles.emptyDescription}>
        This stream no longer exists or hasn&apos;t been created yet.{" "}
        <Link to={CHAT_URL}>Back to System</Link>
      </div>
    </div>
  );
}

/** Chat page — shows System session or a named IPC stream. */
export function ChatPage(): JSX.Element {
  const { streamId } = useParams<{ streamId?: string }>();

  const {
    tasks: { tasks, tasksLoading, startTask },
    sessions: { sessions, sessionsLoading, events, eventsDropped, taskSessions, loadTaskSessions, loadSessionEvents, kill, stopGraceful, sendInput, spawn },
    environments: { environments, provisionEnvironment },
    personas: { personas },
    streams: { streams, streamsLoading, streamsLoadedOnce },
  } = useGrackle();
  const { showToast } = useToast();

  const [showDetail, setShowDetail] = useState(false);

  // ── System mode (no streamId) ──────────────────────────────────────────────

  const loadedSessionRef = useRef<string | undefined>(undefined);
  const [pendingMessage, setPendingMessage] = useState<string | undefined>();

  const rootTask = tasks.find((t) => t.id === ROOT_TASK_ID);
  const systemSession = streamId === undefined
    ? (rootTask?.latestSessionId
        ? (sessions.find((s) => s.id === rootTask.latestSessionId) ??
           (taskSessions[ROOT_TASK_ID] ?? []).find((s) => s.id === rootTask.latestSessionId))
        : undefined)
    : undefined;

  // Load root task sessions on mount (system mode)
  useEffect(() => {
    if (streamId === undefined) {
      loadTaskSessions(ROOT_TASK_ID).catch(() => {});
    }
  }, [streamId, loadTaskSessions]);

  useEffect(() => {
    if (streamId === undefined && rootTask?.latestSessionId) {
      loadTaskSessions(ROOT_TASK_ID).catch(() => {});
    }
  }, [streamId, rootTask?.latestSessionId, loadTaskSessions]);

  // ── Stream mode (streamId present) ────────────────────────────────────────

  const selectedStream = streamId !== undefined
    ? streams.find((s) => s.id === streamId)
    : undefined;

  // Pick the primary subscriber's session (first subscriber, preferring rw)
  const streamSessionId = useMemo(() => {
    if (!selectedStream || selectedStream.subscribers.length === 0) {
      return undefined;
    }
    const rwSub = selectedStream.subscribers.find((s) => s.permission === "rw");
    const primary = rwSub ?? selectedStream.subscribers[0];
    return primary.sessionId;
  }, [selectedStream]);

  const streamSession = streamSessionId !== undefined
    ? sessions.find((s) => s.id === streamSessionId)
    : undefined;

  // ── Shared session resolution ─────────────────────────────────────────────

  const latestSession = streamId === undefined ? systemSession : streamSession;

  // Load events when session known
  useEffect(() => {
    if (latestSession && latestSession.id !== loadedSessionRef.current) {
      loadedSessionRef.current = latestSession.id;
      loadSessionEvents(latestSession.id).catch(() => {});
    }
  }, [latestSession?.id, loadSessionEvents]);

  // Reset loaded session ref and close detail drawer when switching streams
  useEffect(() => {
    loadedSessionRef.current = undefined;
    setShowDetail(false);
  }, [streamId]);

  // Filter + group events for display
  const groupedEvents = useMemo(() => {
    if (!latestSession) {
      return [];
    }
    const filtered = events.filter((e) => e.sessionId === latestSession.id);
    return pairToolEvents(groupConsecutiveTextEvents(filtered));
  }, [events, latestSession?.id]);

  // ── System mode helpers ───────────────────────────────────────────────────

  const localEnvironment = environments.find(
    (e) => e.adapterType === "local" && e.status === "connected",
  );

  const isSessionActive = latestSession !== undefined
    && latestSession.status !== "stopped" && latestSession.status !== "suspended";

  const isSessionIdle = latestSession?.status === "idle";

  useEffect(() => {
    if (pendingMessage && latestSession && isSessionIdle) {
      sendInput(latestSession.id, pendingMessage).catch(() => {});
      setPendingMessage(undefined);
    }
  }, [pendingMessage, isSessionIdle, latestSession?.id, sendInput]);

  const handleStartTask = useCallback(
    (taskId: string, personaId?: string, environmentId?: string, text?: string) => {
      if (text) {
        setPendingMessage(text);
      }
      startTask(taskId, personaId, environmentId).catch(() => {});
    },
    [startTask],
  );

  // ── Loading states ────────────────────────────────────────────────────────

  if (streamId === undefined && !rootTask && (sessionsLoading || tasksLoading)) {
    return <ChatShimmer />;
  }

  if (streamId !== undefined && streamsLoading && !selectedStream) {
    return <ChatShimmer />;
  }

  // ── Stream mode — not found ───────────────────────────────────────────────

  if (streamId !== undefined && !streamsLoading && !selectedStream && streamsLoadedOnce) {
    return (
      <div className={styles.panelContainer} data-testid="chat-page">
        <EventStream
          events={[]}
          eventsDropped={0}
          emptyState={<StreamNotFoundState />}
          onShowToast={showToast}
        />
      </div>
    );
  }

  // ── Determine page title for stream mode header ───────────────────────────
  const headerTitle = streamId !== undefined && selectedStream
    ? selectedStream.name
    : undefined;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.panelContainer} data-testid="chat-page">
      {isSessionActive && (
        <div className={styles.chatHeader}>
          <span className={styles.chatHeaderInfo}>
            {headerTitle && <strong>{headerTitle} &mdash; </strong>}
            Session: {latestSession!.id.slice(0, 8)} | {latestSession!.runtime} | {latestSession!.status}
          </span>
          <div className={styles.chatHeaderActions}>
            {selectedStream && (
              <button
                className={styles.detailButton}
                onClick={() => setShowDetail((v) => !v)}
                aria-label="Stream details"
                aria-expanded={showDetail}
                data-testid="stream-detail-toggle"
              >
                Info
              </button>
            )}
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

      {streamId !== undefined && selectedStream && !latestSession && !sessionsLoading && (
        <EventStream
          events={[]}
          eventsDropped={0}
          emptyState={<StreamNoSessionState streamName={selectedStream.name} />}
          onShowToast={showToast}
        />
      )}

      {(streamId === undefined || latestSession) && (
        <EventStream
          events={groupedEvents}
          eventsDropped={eventsDropped}
          emptyState={
            streamId === undefined
              ? <ChatEmptyState hasLocalEnvironment={!!localEnvironment} />
              : <StreamNoSessionState streamName={selectedStream?.name ?? ""} />
          }
          onShowToast={showToast}
        />
      )}

      {/* System mode chat input */}
      {streamId === undefined && localEnvironment && isSessionActive && (
        <ChatInput
          mode="send"
          sessionId={latestSession!.id}
          environmentId={latestSession!.environmentId}
          personas={personas}
          environments={environments}
          onSendInput={(sid, text) => { sendInput(sid, text).catch(() => {}); }}
          onSpawn={(eid, prompt, pid) => { spawn(eid, prompt, pid).catch(() => {}); }}
          onStartTask={(tid, pid, eid) => { startTask(tid, pid, eid).catch(() => {}); }}
          onProvisionEnvironment={(eid) => { provisionEnvironment(eid).catch(() => {}); }}
          onShowToast={showToast}
        />
      )}
      {streamId === undefined && localEnvironment && !isSessionActive && (
        <ChatInput
          mode="start"
          taskId={ROOT_TASK_ID}
          environmentId={localEnvironment.id}
          personas={personas}
          environments={environments}
          onSendInput={(sid, text) => { sendInput(sid, text).catch(() => {}); }}
          onSpawn={(eid, prompt, pid) => { spawn(eid, prompt, pid).catch(() => {}); }}
          onStartTask={handleStartTask}
          onProvisionEnvironment={(eid) => { provisionEnvironment(eid).catch(() => {}); }}
          onShowToast={showToast}
        />
      )}

      {/* Right drawer: stream details */}
      {showDetail && selectedStream && (
        <StreamDetailPanel
          stream={selectedStream}
          onClose={() => setShowDetail(false)}
        />
      )}
    </div>
  );
}
