import { useGrackle } from "../../context/GrackleContext.js";
import { EventRenderer } from "../display/EventRenderer.js";
import { DiffViewer } from "../display/DiffViewer.js";
import { FindingsPanel } from "./FindingsPanel.js";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { ViewMode } from "../../App.js";
import type { Session, SessionEvent } from "../../hooks/useGrackleSocket.js";
import { AnimatePresence, motion } from "motion/react";
import styles from "./SessionPanel.module.scss";

/** Props for the SessionPanel component. */
interface Props {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

// --- Subcomponents ---

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

/** Props for the EventList subcomponent. */
interface EventListProps {
  sessionEvents: SessionEvent[];
  session: Session | undefined;
  // eslint-disable-next-line @rushstack/no-new-null
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/** Scrollable list of session events with empty-state messaging. */
function EventList({ sessionEvents, session, scrollRef }: EventListProps): JSX.Element {
  const isTerminal = session && ["completed", "failed", "killed"].includes(session.status);
  const emptyMessage = isTerminal
    ? `Session ${session.status} with no events recorded.`
    : "Waiting for events...";

  return (
    <div ref={scrollRef} className={styles.eventScroll}>
      {sessionEvents.length === 0 && (
        <div className={isTerminal ? styles.errorMessage : styles.waitingMessage}>{emptyMessage}</div>
      )}
      {sessionEvents.map((event, i) => (
        <EventRenderer key={i} event={event} />
      ))}
    </div>
  );
}

/**
 * Merges consecutive "text" events into single entries with concatenated content.
 * This prevents streaming deltas from rendering as one token per line, producing
 * coherent text blocks that can be displayed as markdown.
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

// --- Main component ---

type TaskTab = "stream" | "diff" | "findings";

/** Main content panel that renders session streams, task views, project summaries, or empty states based on the current view mode. */
export function SessionPanel({ viewMode, setViewMode }: Props): JSX.Element {
  const { events, sessions, tasks, taskDiff, loadSessionEvents, loadFindings, loadTaskDiff, kill } = useGrackle();
  // eslint-disable-next-line @rushstack/no-new-null
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<string | undefined>(undefined);
  const [activeTaskTab, setActiveTaskTab] = useState<TaskTab>("stream");
  const prevTaskStatusRef = useRef<string | undefined>(undefined);

  // Determine session context
  let sessionId: string | undefined = undefined;
  let task: ReturnType<typeof tasks.find> = undefined;
  let projectId: string | undefined = undefined;

  if (viewMode.kind === "session") {
    sessionId = viewMode.sessionId;
  } else if (viewMode.kind === "task") {
    task = tasks.find((t) => t.id === viewMode.taskId);
    sessionId = task?.sessionId || undefined;
    projectId = task?.projectId || undefined;
  }

  // Auto-switch tab synchronously during render (not via effect) so the
  // correct tab is committed in the same frame as the status change.
  // React supports calling setState during render as a getDerivedStateFromProps
  // replacement — it re-renders immediately without committing the stale frame.
  if (task?.status !== prevTaskStatusRef.current) {
    prevTaskStatusRef.current = task?.status;
    const newTab: TaskTab | undefined =
      task?.status === "in_progress" ? "stream"
      : task?.status === "review" ? "diff"
      : task?.status === "done" ? "findings"
      : undefined;
    if (newTab && newTab !== activeTaskTab) {
      setActiveTaskTab(newTab);
    }
  }

  const sessionEvents = sessionId
    ? events.filter((e) => e.sessionId === sessionId)
    : [];

  const groupedEvents = useMemo(
    () => groupConsecutiveTextEvents(sessionEvents),
    [sessionEvents]
  );

  const session = sessionId
    ? sessions.find((s) => s.id === sessionId) ?? undefined
    : undefined;

  // Load historical events when selecting a session
  useEffect(() => {
    if (sessionId && sessionId !== loadedRef.current) {
      loadedRef.current = sessionId;
      loadSessionEvents(sessionId);
    }
  }, [sessionId, loadSessionEvents]);

  // Load findings/diff when switching tabs
  useEffect(() => {
    if (activeTaskTab === "findings" && projectId) {
      loadFindings(projectId);
    }
    if (activeTaskTab === "diff" && task?.id) {
      loadTaskDiff(task.id);
    }
  }, [activeTaskTab, projectId, task?.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && activeTaskTab === "stream") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessionEvents.length, activeTaskTab]);

  // --- empty mode ---
  if (viewMode.kind === "empty") {
    return (
      <div className={styles.emptyState}>
        Select a session, project, or task to get started
      </div>
    );
  }

  // --- new_chat mode ---
  if (viewMode.kind === "new_chat") {
    return (
      <div className={styles.emptyState}>
        Enter a prompt below to start a new session
      </div>
    );
  }

  // --- project mode ---
  if (viewMode.kind === "project") {
    const projectTasks = tasks.filter((t) => t.projectId === viewMode.projectId);
    const done = projectTasks.filter((t) => t.status === "done").length;
    const total = projectTasks.length;
    return (
      <div className={styles.projectSummary}>
        <span className={styles.projectSummaryTitle}>
          {total > 0 ? `${done}/${total} tasks complete` : "No tasks yet"}
        </span>
        <span className={styles.projectSummarySubtitle}>Select a task or click + to create one</span>
      </div>
    );
  }

  // --- new_task mode ---
  if (viewMode.kind === "new_task") {
    return (
      <div className={styles.emptyState}>
        Fill in the task details below
      </div>
    );
  }

  // --- task mode ---
  if (viewMode.kind === "task") {
    const isActive = session?.status === "running" || session?.status === "waiting_input";

    return (
      <div className={styles.panelContainer}>
        {/* Task header */}
        <div className={styles.header}>
          <span>
            Task: {task?.title || viewMode.taskId}
            {task && ` | ${task.status}`}
            {task?.branch && ` | ${task.branch}`}
          </span>
          {isActive && (
            <button
              onClick={() => sessionId && kill(sessionId)}
              title="Stop session"
              className={styles.killButton}
            >
              {"\u00D7"}
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${activeTaskTab === "stream" ? styles.active : ""}`}
            onClick={() => setActiveTaskTab("stream")}
          >
            Stream
          </button>
          <button
            className={`${styles.tab} ${activeTaskTab === "diff" ? styles.active : ""}`}
            onClick={() => setActiveTaskTab("diff")}
          >
            Diff
          </button>
          <button
            className={`${styles.tab} ${activeTaskTab === "findings" ? styles.active : ""}`}
            onClick={() => setActiveTaskTab("findings")}
          >
            Findings
          </button>
        </div>

        {/* Tab content with animation */}
        <AnimatePresence mode="wait">
          {activeTaskTab === "stream" && (
            <motion.div
              key="stream"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              ref={scrollRef}
              className={styles.eventScroll}
            >
              {!sessionId && (
                <div className={styles.waitingMessage}>Task has not been started yet</div>
              )}
              {sessionId && groupedEvents.length === 0 && (
                <div className={styles.waitingMessage}>Waiting for events...</div>
              )}
              {groupedEvents.map((event, i) => (
                <EventRenderer key={i} event={event} />
              ))}
            </motion.div>
          )}

          {activeTaskTab === "diff" && (
            <motion.div
              key="diff"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className={styles.tabContent}
            >
              <DiffViewer diff={taskDiff} />
            </motion.div>
          )}

          {activeTaskTab === "findings" && (
            <motion.div
              key="findings"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className={styles.tabContent}
            >
              {projectId ? (
                <FindingsPanel projectId={projectId} />
              ) : (
                <div className={styles.noContext}>
                  No project context
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // --- session mode (legacy/direct) ---
  const isActive = session?.status === "running" || session?.status === "waiting_input";

  return (
    <div className={styles.panelContainer}>
      <SessionHeader
        sessionId={sessionId!}
        session={session}
        isActive={isActive}
        onKill={kill}
      />
      <EventList
        sessionEvents={groupedEvents}
        session={session}
        scrollRef={scrollRef}
      />
    </div>
  );
}
