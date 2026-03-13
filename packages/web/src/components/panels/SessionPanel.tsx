import { useGrackle } from "../../context/GrackleContext.js";
import { EventRenderer } from "../display/EventRenderer.js";
import { FindingsPanel } from "./FindingsPanel.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { PersonaManager } from "../personas/PersonaManager.js";
import { DagView } from "../dag/DagView.js";
import { useEffect, useMemo, useRef, useState, type JSX, type RefObject } from "react";
import type { ViewMode } from "../../App.js";
import type { Session, SessionEvent, TaskData, Environment, Project } from "../../hooks/useGrackleSocket.js";
import { AnimatePresence, motion } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./SessionPanel.module.scss";
import { ConfirmDialog } from "../display/index.js";

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
  sessionEvents: SessionEvent[];
  session: Session | undefined;
  eventsDropped: number;
  // eslint-disable-next-line @rushstack/no-new-null
  scrollRef: RefObject<HTMLDivElement | null>;
}

/** Scrollable list of session events with empty-state messaging. */
function EventList({ sessionEvents, session, eventsDropped, scrollRef }: EventListProps): JSX.Element {
  const isTerminal = session && ["completed", "failed", "killed"].includes(session.status);
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
        <EventRenderer key={`${event.sessionId}-${event.timestamp}-${i}`} event={event} />
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

// --- Overview helpers ---

/** Formats an ISO timestamp into a human-readable local date/time string. */
function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Returns a human-readable duration string between two ISO timestamps, or undefined if not computable. */
function formatDuration(start: string | undefined, end: string | undefined): string | undefined {
  if (!start || !end) return undefined;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (isNaN(ms) || ms < 0) return undefined;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins === 0) return `${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours === 0) return `${mins}m ${secs}s`;
  return `${hours}h ${remMins}m`;
}

/** Derives a color class for an environment status string. */
function envStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "ready" || s === "running" || s === "available" || s === "connected") return styles.envDotGreen;
  if (s === "provisioning" || s === "starting" || s === "pending" || s === "connecting") return styles.envDotYellow;
  if (s === "error" || s === "failed" || s === "disconnected") return styles.envDotRed;
  return styles.envDotGray;
}

/** Props for the TaskStatusBadge component. */
interface TaskStatusBadgeProps {
  status: string;
}

/** Large colored badge displaying the current task status. */
function TaskStatusBadge({ status }: TaskStatusBadgeProps): JSX.Element {
  const labelMap: Record<string, string> = {
    pending: "Pending",
    assigned: "Assigned",
    in_progress: "In Progress",
    review: "Review",
    done: "Done",
    failed: "Failed",
  };
  const colorClassMap: Record<string, string> = {
    pending: styles.statusPending,
    assigned: styles.statusAssigned,
    in_progress: styles.statusInProgress,
    review: styles.statusReview,
    done: styles.statusDone,
    failed: styles.statusFailed,
  };
  return (
    <span className={`${styles.statusBadge} ${colorClassMap[status] ?? styles.statusPending}`}>
      {labelMap[status] ?? status}
    </span>
  );
}

/** Props for the TaskOverview component. */
interface TaskOverviewProps {
  task: TaskData;
  tasksById: Map<string, TaskData>;
  environments: Environment[];
  projects: Project[];
}

/** Enriched overview dashboard for a task: status, branch, description, environment, deps, timeline, review notes. */
function TaskOverview({ task, tasksById, environments, projects }: TaskOverviewProps): JSX.Element {
  const env = environments.find((e) => e.id === task.environmentId);
  const project = projects.find((p) => p.id === task.projectId);

  // Build GitHub branch URL if the project has a repoUrl; encode the full
  // branch name so special characters (spaces, %, etc.) are safe in the URL.
  const branchUrl = task.branch && project?.repoUrl
    ? `${project.repoUrl.replace(/\/$/, "")}/tree/${encodeURIComponent(task.branch)}`
    : undefined;

  return (
    <div className={styles.overviewDashboard}>
      {/* Hero: status badge */}
      <div className={styles.overviewHero}>
        <TaskStatusBadge status={task.status} />
        {task.branch && (
          <span className={styles.overviewBranchPill}>
            {branchUrl ? (
              <a href={branchUrl} target="_blank" rel="noreferrer noopener" className={styles.branchLink}>
                {"\u{1F517}"} {task.branch}
              </a>
            ) : (
              <span>{"\u{1F517}"} {task.branch}</span>
            )}
          </span>
        )}
      </div>

      {/* Description */}
      {typeof task.description === "string" && task.description && (
        <div className={styles.overviewSection}>
          <div className={styles.overviewLabel}>Description</div>
          <div className={styles.overviewMarkdown}>
            <Markdown remarkPlugins={[remarkGfm]}>{task.description}</Markdown>
          </div>
        </div>
      )}

      {/* Environment */}
      {task.environmentId && (
        <div className={styles.overviewSection}>
          <div className={styles.overviewLabel}>Environment</div>
          <div className={styles.envRow}>
            {env && (
              <span
                className={`${styles.envDot} ${envStatusClass(env.status)}`}
                title={env.status}
                aria-label={`Status: ${env.status}`}
                role="img"
              />
            )}
            <span className={styles.overviewValue}>
              {env?.displayName ?? task.environmentId}
            </span>
          </div>
        </div>
      )}

      {/* Dependencies — always shown */}
      <div className={styles.overviewSection}>
        <div className={styles.overviewLabel}>Dependencies</div>
        {task.dependsOn.length === 0 ? (
          <div className={styles.overviewMuted}>None</div>
        ) : (
          <div className={styles.depList}>
            {task.dependsOn.map((depId) => {
              const dep = tasksById.get(depId);
              const isDone = dep?.status === "done";
              return (
                <div
                  key={depId}
                  className={`${styles.depItem} ${isDone ? styles.depDone : styles.depBlocked}`}
                >
                  <span>{isDone ? "\u2713" : "\u25CB"}</span>
                  <span>{dep?.title ?? depId}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className={styles.overviewSection}>
        <div className={styles.overviewLabel}>Timeline</div>
        <div className={styles.timeline}>
          {task.createdAt && (
            <div className={styles.timelineRow}>
              <span className={styles.timelineKey}>Created</span>
              <span className={styles.timelineValue}>{formatDate(task.createdAt)}</span>
            </div>
          )}
          {task.assignedAt && (() => {
            const delta = formatDuration(task.createdAt, task.assignedAt);
            return (
              <div className={styles.timelineRow}>
                <span className={styles.timelineKey}>Assigned</span>
                <span className={styles.timelineValue}>{formatDate(task.assignedAt)}</span>
                {delta !== undefined && <span className={styles.timelineDelta}>{delta}</span>}
              </div>
            );
          })()}
          {task.startedAt && (() => {
            const delta = formatDuration(task.assignedAt ?? task.createdAt, task.startedAt);
            return (
              <div className={styles.timelineRow}>
                <span className={styles.timelineKey}>Started</span>
                <span className={styles.timelineValue}>{formatDate(task.startedAt)}</span>
                {delta !== undefined && <span className={styles.timelineDelta}>{delta}</span>}
              </div>
            );
          })()}
          {task.completedAt && (() => {
            const delta = formatDuration(task.startedAt, task.completedAt);
            return (
              <div className={styles.timelineRow}>
                <span className={styles.timelineKey}>Completed</span>
                <span className={styles.timelineValue}>{formatDate(task.completedAt)}</span>
                {delta !== undefined && <span className={styles.timelineDelta}>{delta}</span>}
              </div>
            );
          })()}
          {!task.createdAt && !task.assignedAt && !task.startedAt && !task.completedAt && (
            <div className={styles.overviewMuted}>No timing data</div>
          )}
        </div>
      </div>

      {/* Review notes */}
      {task.reviewNotes && (
        <div className={styles.overviewSection}>
          <div className={styles.overviewLabel}>Review Notes</div>
          <div className={styles.reviewNotes}>{task.reviewNotes}</div>
        </div>
      )}
    </div>
  );
}

// --- Main component ---

type TaskTab = "overview" | "stream" | "findings";
type ProjectTab = "tasks" | "graph";

/** Props for the TaskActionButtons subcomponent. */
interface TaskActionButtonsProps {
  task: TaskData;
  sessionId: string | undefined;
  isBlocked: boolean;
  rejectNotes: string;
  onRejectNotesChange: (notes: string) => void;
  onStart: () => void;
  onStop: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
}

/** Context-dependent action buttons rendered in the task detail header. */
function TaskActionButtons({
  task,
  sessionId,
  isBlocked,
  rejectNotes,
  onRejectNotesChange,
  onStart,
  onStop,
  onApprove,
  onReject,
  onDelete,
}: TaskActionButtonsProps): JSX.Element | undefined {
  if (task.status === "pending" || task.status === "assigned") {
    if (isBlocked) {
      return (
        <div className={styles.headerActions}>
          <button onClick={onDelete} className={styles.btnDanger}>Delete</button>
        </div>
      );
    }
    return (
      <div className={styles.headerActions}>
        <button onClick={onStart} className={styles.btnPrimary}>Start</button>
        <button onClick={onDelete} className={styles.btnDanger}>Delete</button>
      </div>
    );
  }

  if (task.status === "in_progress") {
    return (
      <div className={styles.headerActions}>
        <button
          onClick={onStop}
          disabled={!sessionId}
          className={styles.btnDanger}
        >
          Stop
        </button>
      </div>
    );
  }

  if (task.status === "review") {
    return (
      <div className={styles.headerActions}>
        <input
          type="text"
          value={rejectNotes}
          onChange={(e) => onRejectNotesChange(e.target.value)}
          placeholder="Rejection notes..."
          className={styles.rejectInput}
        />
        <button onClick={onApprove} className={styles.btnPrimary}>Approve</button>
        <button onClick={onReject} className={styles.btnDanger}>Reject</button>
      </div>
    );
  }

  if (task.status === "done") {
    return (
      <div className={styles.headerActions}>
        <button onClick={onDelete} className={styles.btnDanger}>Delete</button>
      </div>
    );
  }

  if (task.status === "failed") {
    return (
      <div className={styles.headerActions}>
        <button onClick={onStart} className={styles.btnPrimary}>Retry</button>
        <button onClick={onDelete} className={styles.btnDanger}>Delete</button>
      </div>
    );
  }

  return undefined;
}

/** Props for the SessionAttemptSelector component. */
interface SessionAttemptSelectorProps {
  taskSessions: Session[];
  selectedSessionId: string | undefined;
  onSelect: (sessionId: string) => void;
}

/** Renders a row of buttons for switching between session attempts (only when 2+). */
function SessionAttemptSelector({ taskSessions, selectedSessionId, onSelect }: SessionAttemptSelectorProps): JSX.Element | undefined {
  if (taskSessions.length < 2) {
    return undefined;
  }
  return (
    <div className={styles.attemptSelector} data-testid="attempt-selector">
      <span className={styles.attemptLabel}>Attempts:</span>
      {taskSessions.map((s, i) => {
        const isActive = s.id === selectedSessionId;
        const statusIcon = s.status === "completed" ? "\u2713"
          : s.status === "failed" ? "\u2717"
          : s.status === "running" || s.status === "waiting_input" ? "\u25CF"
          : "";
        return (
          <button
            key={s.id}
            className={`${styles.attemptButton} ${isActive ? styles.attemptActive : ""}`}
            onClick={() => onSelect(s.id)}
            title={`Attempt #${i + 1} — ${s.status}`}
            aria-label={`Attempt #${i + 1}, ${s.status}`}
            aria-pressed={isActive}
            data-testid={`attempt-${i + 1}`}
          >
            #{i + 1}
            {statusIcon && <span className={styles.attemptStatus}>{statusIcon}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Main content panel that renders session streams, task views, project summaries, or empty states based on the current view mode. */
export function SessionPanel({ viewMode, setViewMode }: Props): JSX.Element {
  const {
    events, eventsDropped, sessions, tasks, environments,
    loadSessionEvents, loadFindings,
    kill, startTask, approveTask, rejectTask, deleteTask,
    projects, createProject,
    taskSessions, loadTaskSessions,
  } = useGrackle();
  // eslint-disable-next-line @rushstack/no-new-null
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<string | undefined>(undefined);
  const [activeTaskTab, setActiveTaskTab] = useState<TaskTab>("overview");
  const [projectTab, setProjectTab] = useState<ProjectTab>("tasks");
  const [rejectNotes, setRejectNotes] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const prevTaskIdRef = useRef<string | undefined>(undefined);
  const prevTaskStatusRef = useRef<string | undefined>(undefined);

  // Determine task and project context
  let task: ReturnType<typeof tasks.find> = undefined;
  let projectId: string | undefined = undefined;

  if (viewMode.kind === "task") {
    task = tasks.find((t) => t.id === viewMode.taskId);
    projectId = task?.projectId || undefined;
  }

  // Resolve effective sessionId — use selectedSessionId if valid, otherwise task.sessionId
  const currentTaskSessions = task ? (taskSessions[task.id] ?? []) : [];
  let sessionId: string | undefined = undefined;
  if (viewMode.kind === "session") {
    sessionId = viewMode.sessionId;
  } else if (viewMode.kind === "task") {
    if (selectedSessionId && currentTaskSessions.some((s) => s.id === selectedSessionId)) {
      sessionId = selectedSessionId;
    } else {
      sessionId = task?.sessionId || undefined;
    }
  }

  // Delete handler for task actions — opens ConfirmDialog
  const handleDeleteTask = (): void => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = (): void => {
    if (!task) return;
    deleteTask(task.id);
    setShowDeleteConfirm(false);
    setViewMode({ kind: "project", projectId: task.projectId });
  };

  // Reset to overview tab, clear rejectNotes, and clear selectedSessionId when switching tasks.
  if (viewMode.kind === "task" && task?.id !== prevTaskIdRef.current) {
    prevTaskIdRef.current = task?.id;
    if (activeTaskTab !== "overview") {
      setActiveTaskTab("overview");
    }
    if (rejectNotes !== "") {
      setRejectNotes("");
    }
    if (selectedSessionId !== undefined) {
      setSelectedSessionId(undefined);
    }
  }

  // Load task sessions when task changes or when a new session is created (retry)
  const loadedTaskSessionsRef = useRef<string | undefined>(undefined);
  const prevTaskSessionIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!task?.id) {
      return;
    }
    const isNewTask = task.id !== loadedTaskSessionsRef.current;
    const sessionChanged = task.sessionId !== prevTaskSessionIdRef.current;
    if (isNewTask || sessionChanged) {
      loadedTaskSessionsRef.current = task.id;
      prevTaskSessionIdRef.current = task.sessionId;
      loadTaskSessions(task.id);
    }
  }, [task?.id, task?.sessionId, loadTaskSessions]);

  // Auto-switch tab synchronously during render (not via effect) so the
  // correct tab is committed in the same frame as the status change.
  // React supports calling setState during render as a getDerivedStateFromProps
  // replacement — it re-renders immediately without committing the stale frame.
  if (task?.status !== prevTaskStatusRef.current) {
    prevTaskStatusRef.current = task?.status;
    const newTab: TaskTab | undefined =
      task?.status === "pending" ? "overview"
      : task?.status === "assigned" ? "overview"
      : task?.status === "in_progress" ? "stream"
      : task?.status === "review" ? "stream"
      : task?.status === "done" ? "findings"
      : undefined;
    if (newTab && newTab !== activeTaskTab) {
      setActiveTaskTab(newTab);
    }
  }

  const groupedEvents = useMemo(() => {
    const filtered = sessionId
      ? events.filter((e) => e.sessionId === sessionId)
      : [];
    return groupConsecutiveTextEvents(filtered);
  }, [events, sessionId]);

  const tasksById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks],
  );

  // Check if task is blocked by unfinished dependencies (uses tasksById for O(deps) lookup)
  const isTaskBlocked = task
    ? task.dependsOn.some((depId) => {
        const dep = tasksById.get(depId);
        return dep !== undefined && dep.status !== "done";
      })
    : false;

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

  // Load findings when switching to findings tab
  useEffect(() => {
    if (activeTaskTab === "findings" && projectId) {
      loadFindings(projectId);
    }
  }, [activeTaskTab, projectId, loadFindings]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && activeTaskTab === "stream") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [groupedEvents.length, activeTaskTab]);

  // --- settings mode ---
  if (viewMode.kind === "settings") {
    return <SettingsPanel viewMode={viewMode} setViewMode={setViewMode} />;
  }

  // --- persona management mode ---
  if (viewMode.kind === "persona_management") {
    return <PersonaManager />;
  }

  // --- empty mode ---
  if (viewMode.kind === "empty") {
    if (projects.length === 0) {
      return (
        <div className={styles.emptyCta}>
          <div className={styles.ctaTitle}>Welcome to Grackle</div>
          <div className={styles.ctaDescription}>
            Organize your work into projects and let agents tackle the tasks.
          </div>
          <button
            className={styles.ctaButton}
            onClick={() => {
              const name = window.prompt("Project name:");
              if (name?.trim()) {
                createProject(name.trim());
              }
            }}
          >
            Create Your First Project
          </button>
        </div>
      );
    }
    return (
      <div className={styles.emptyState}>
        Select a project or task to get started
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
      <div className={styles.panelContainer}>
        <div className={styles.tabBar} role="tablist" aria-label="Project view">
          <button
            role="tab"
            aria-selected={projectTab === "graph"}
            className={`${styles.tab} ${projectTab === "graph" ? styles.active : ""}`}
            onClick={() => setProjectTab("graph")}
          >
            Graph
          </button>
          <button
            role="tab"
            aria-selected={projectTab === "tasks"}
            className={`${styles.tab} ${projectTab === "tasks" ? styles.active : ""}`}
            onClick={() => setProjectTab("tasks")}
          >
            Tasks
          </button>
        </div>
        {projectTab === "tasks" && total > 0 && (
          <div className={styles.projectSummary}>
            <span className={styles.projectSummaryTitle}>
              {`${done}/${total} tasks complete`}
            </span>
            <span className={styles.projectSummarySubtitle}>Select a task or click + to create one</span>
          </div>
        )}
        {projectTab === "tasks" && total === 0 && (
          <div className={styles.emptyCta}>
            <button
              className={styles.ctaButton}
              onClick={() => setViewMode({ kind: "new_task", projectId: viewMode.projectId })}
            >
              Create Task
            </button>
            <div className={styles.ctaDescription}>
              Break your work into tasks and let agents tackle them
            </div>
          </div>
        )}
        {projectTab === "graph" && (
          <DagView projectId={viewMode.projectId} setViewMode={setViewMode} />
        )}
      </div>
    );
  }

  // --- new_environment mode ---
  if (viewMode.kind === "new_environment") {
    return (
      <div className={styles.emptyState}>
        Configure the new environment below
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
    return (
      <div className={styles.panelContainer}>
        {/* Task header with contextual action buttons */}
        <div className={styles.header}>
          <span className={styles.headerTitle}>
            <span data-testid="task-title">{task?.title || viewMode.taskId}</span>
            {task && <span className={styles.taskStatusBadge} data-testid="task-status">{task.status}</span>}
            {task?.branch && <span className={styles.taskBranch}>{task.branch}</span>}
            {isTaskBlocked && <span className={styles.taskBlockedBadge}>blocked</span>}
          </span>
          {task && (
            <TaskActionButtons
              task={task}
              sessionId={sessionId}
              isBlocked={isTaskBlocked}
              rejectNotes={rejectNotes}
              onRejectNotesChange={setRejectNotes}
              onStart={() => startTask(task.id)}
              onStop={() => sessionId && kill(sessionId)}
              onApprove={() => approveTask(task.id)}
              onReject={() => { rejectTask(task.id, rejectNotes); setRejectNotes(""); }}
              onDelete={handleDeleteTask}
            />
          )}
        </div>

        {/* Tab bar */}
        <div className={styles.tabBar} role="tablist" aria-label="Task view">
          <button
            role="tab"
            aria-selected={activeTaskTab === "overview"}
            className={`${styles.tab} ${activeTaskTab === "overview" ? styles.active : ""}`}
            onClick={() => setActiveTaskTab("overview")}
          >
            Overview
          </button>
          <button
            role="tab"
            aria-selected={activeTaskTab === "stream"}
            className={`${styles.tab} ${activeTaskTab === "stream" ? styles.active : ""}`}
            onClick={() => setActiveTaskTab("stream")}
          >
            Stream
          </button>
          <button
            role="tab"
            aria-selected={activeTaskTab === "findings"}
            className={`${styles.tab} ${activeTaskTab === "findings" ? styles.active : ""}`}
            onClick={() => setActiveTaskTab("findings")}
          >
            Findings
          </button>
        </div>

        {/* Tab content with animation */}
        <AnimatePresence mode="wait">
          {activeTaskTab === "overview" && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className={styles.overviewContent}
            >
              {task ? (
                <TaskOverview
                  task={task}
                  tasksById={tasksById}
                  environments={environments}
                  projects={projects}
                />
              ) : (
                <div className={styles.waitingMessage}>No additional details</div>
              )}
            </motion.div>
          )}

          {activeTaskTab === "stream" && (
            <motion.div
              key="stream"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}
            >
              <SessionAttemptSelector
                taskSessions={currentTaskSessions}
                selectedSessionId={sessionId}
                onSelect={(id) => {
                  setSelectedSessionId(id);
                }}
              />
              <div ref={scrollRef} className={styles.eventScroll}>
                {!sessionId && task && (
                  <div className={styles.emptyCta}>
                    <button
                      className={styles.ctaButton}
                      onClick={() => startTask(task.id)}
                    >
                      Start Task
                    </button>
                    <div className={styles.ctaDescription}>
                      Click to begin agent execution
                    </div>
                  </div>
                )}
                {sessionId && groupedEvents.length === 0 && (
                  <div className={styles.waitingMessage}>Waiting for events...</div>
                )}
                <EventOverflowBanner eventsDropped={eventsDropped} />
                {groupedEvents.map((event, i) => (
                  <EventRenderer key={`${event.sessionId}-${event.timestamp}-${i}`} event={event} />
                ))}
              </div>
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
                  Navigate to a task within a project to view findings
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {task && (
          <ConfirmDialog
            isOpen={showDeleteConfirm}
            title="Delete Task?"
            description={`"${task.title}" will be permanently removed.`}
            onConfirm={handleDeleteConfirm}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        )}
      </div>
    );
  }

  // --- session mode (legacy/direct) ---
  if (!sessionId) {
    return (
      <div className={styles.emptyState}>
        No session selected
      </div>
    );
  }

  const isActive = session?.status === "running" || session?.status === "waiting_input";

  return (
    <div className={styles.panelContainer}>
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
