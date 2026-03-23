import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useParams, useLocation } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import { EventStream } from "../components/display/EventStream.js";
import { ChatInput } from "../components/chat/index.js";
import { FindingsPanel } from "../components/panels/FindingsPanel.js";
import { Breadcrumbs, ConfirmDialog } from "../components/display/index.js";
import { buildTaskBreadcrumbs } from "../utils/breadcrumbs.js";
import { taskEditUrl, taskUrl, workspaceUrl, useAppNavigate } from "../utils/navigation.js";
import { getStatusBadgeClassKey, getStatusStyle } from "../utils/taskStatus.js";
import type { Session, TaskData, Environment, Workspace } from "../hooks/useGrackleSocket.js";
import { AnimatePresence, motion } from "motion/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatCost } from "../utils/format.js";
import { groupConsecutiveTextEvents, pairToolEvents } from "../utils/sessionEvents.js";
import styles from "../components/panels/SessionPanel.module.scss";

type TaskTab = "overview" | "stream" | "findings";

// --- Helper functions ---

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

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

function envStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "ready" || s === "running" || s === "available" || s === "connected") return styles.envDotGreen;
  if (s === "provisioning" || s === "starting" || s === "pending" || s === "connecting") return styles.envDotYellow;
  if (s === "error" || s === "failed" || s === "disconnected") return styles.envDotRed;
  return styles.envDotGray;
}

// --- Subcomponents ---

function TaskStatusBadge({ status }: { status: string }): JSX.Element {
  const style = getStatusStyle(status);
  const classKey = getStatusBadgeClassKey(status);
  return (
    <span className={`${styles.statusBadge} ${styles[classKey] ?? styles.statusPending}`}>
      {style.label}
    </span>
  );
}

interface TaskOverviewProps {
  task: TaskData;
  tasksById: Map<string, TaskData>;
  environments: Environment[];
  workspaces: Workspace[];
  taskSessions: Session[];
  selectedEnvId: string;
}

function TaskOverview({ task, tasksById, environments, workspaces, taskSessions, selectedEnvId }: TaskOverviewProps): JSX.Element {
  const { loadUsage, usageCache } = useGrackle();

  // Load usage stats for this task (and tree if it has children)
  const sessionCostSum = taskSessions.reduce((s, sess) => s + (sess.costUsd ?? 0), 0);
  useEffect(() => {
    loadUsage("task", task.id);
    if (task.childTaskIds.length > 0) {
      loadUsage("task_tree", task.id);
    }
  }, [task.id, task.childTaskIds.length, loadUsage, sessionCostSum]);

  const taskUsageKey = `task:${task.id}`;
  const taskUsage = taskUsageKey in usageCache ? usageCache[taskUsageKey] : undefined;
  const treeUsageKey = `task_tree:${task.id}`;
  const treeUsage = task.childTaskIds.length > 0 && treeUsageKey in usageCache ? usageCache[treeUsageKey] : undefined;

  const latestSession = taskSessions.length > 0 ? taskSessions[taskSessions.length - 1] : undefined;
  const envId = latestSession?.environmentId ?? "";
  const env = envId ? environments.find((e) => e.id === envId) : undefined;
  const workspace = workspaces.find((p) => p.id === task.workspaceId);
  const selectedEnv = environments.find((e) => e.id === selectedEnvId);
  const branchUrl = task.branch && workspace?.repoUrl
    ? `${workspace.repoUrl.replace(/\/$/, "")}/tree/${encodeURIComponent(task.branch)}`
    : undefined;

  return (
    <div className={styles.overviewDashboard}>
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
      {typeof task.description === "string" && task.description && (
        <div className={styles.overviewSection}>
          <div className={styles.overviewLabel}>Description</div>
          <div className={styles.overviewMarkdown}>
            <Markdown remarkPlugins={[remarkGfm]}>{task.description}</Markdown>
          </div>
        </div>
      )}
      <div className={styles.overviewSection}>
        <div className={styles.overviewLabel}>Environment</div>
        {envId && env ? (
          <div className={styles.envRow} data-testid="task-overview-environment">
            <span className={`${styles.envDot} ${envStatusClass(env.status)}`} title={env.status} aria-label={`Status: ${env.status}`} role="img" />
            <span className={styles.overviewValue}>{env.displayName}</span>
          </div>
        ) : selectedEnv ? (
          <div className={styles.envRow} data-testid="task-overview-environment">
            <span className={`${styles.envDot} ${envStatusClass(selectedEnv.status)}`} title={selectedEnv.status} aria-label={`Status: ${selectedEnv.status}`} role="img" />
            <span className={styles.overviewValue}>{selectedEnv.displayName}</span>
            <span className={styles.overviewMuted}>(workspace default)</span>
          </div>
        ) : (
          <div className={styles.overviewMuted}>Set in workspace settings</div>
        )}
      </div>
      <div className={styles.overviewSection}>
        <div className={styles.overviewLabel}>Dependencies</div>
        {task.dependsOn.length === 0 ? (
          <div className={styles.overviewMuted}>None</div>
        ) : (
          <div className={styles.depList}>
            {task.dependsOn.map((depId) => {
              const dep = tasksById.get(depId);
              const isDone = dep?.status === "complete";
              return (
                <div key={depId} className={`${styles.depItem} ${isDone ? styles.depDone : styles.depBlocked}`}>
                  <span>{isDone ? "\u2713" : "\u25CB"}</span>
                  <span>{dep?.title ?? depId}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
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
      {taskUsage && taskUsage.costUsd > 0 && (
        <div className={styles.overviewSection}>
          <div className={styles.overviewLabel}>Usage</div>
          <div className={styles.timeline}>
            <div className={styles.timelineRow}>
              <span className={styles.timelineKey}>Cost</span>
              <span className={styles.timelineValue}>{formatCost(taskUsage.costUsd)}</span>
              <span className={styles.timelineDelta}>{taskUsage.sessionCount} session{taskUsage.sessionCount !== 1 ? "s" : ""}</span>
            </div>
            {treeUsage && treeUsage.costUsd > taskUsage.costUsd && (
              <div className={styles.timelineRow}>
                <span className={styles.timelineKey}>Total (incl. subtasks)</span>
                <span className={styles.timelineValue}>{formatCost(treeUsage.costUsd)}</span>
                <span className={styles.timelineDelta}>{treeUsage.sessionCount} session{treeUsage.sessionCount !== 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {task.reviewNotes && (
        <div className={styles.overviewSection}>
          <div className={styles.overviewLabel}>Review Notes</div>
          <div className={styles.reviewNotes}>{task.reviewNotes}</div>
        </div>
      )}
    </div>
  );
}

interface TaskActionButtonsProps {
  task: TaskData;
  sessionId: string | undefined;
  isBlocked: boolean;
  onStart: () => void;
  onResume: () => void;
  onStop: () => void;
  onPause: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

function TaskActionButtons({
  task, sessionId, isBlocked,
  onStart, onResume, onStop, onPause, onDelete, onEdit,
}: TaskActionButtonsProps): JSX.Element | undefined {
  if (task.status === "not_started") {
    if (isBlocked) {
      return (
        <div className={styles.headerActions}>
          <button onClick={onEdit} className={styles.btnGhost}>Edit</button>
          <button onClick={onDelete} className={styles.btnDanger}>Delete</button>
        </div>
      );
    }
    return (
      <div className={styles.headerActions}>
        <button onClick={onStart} className={styles.btnPrimary}>Start</button>
        <button onClick={onEdit} className={styles.btnGhost}>Edit</button>
        <button onClick={onDelete} className={styles.btnDanger}>Delete</button>
      </div>
    );
  }
  if (task.status === "working") {
    return (
      <div className={styles.headerActions}>
        <button onClick={onStop} className={styles.btnDanger}>Stop</button>
        <button onClick={onPause} disabled={!sessionId} className={styles.btnGhost}>Pause</button>
      </div>
    );
  }
  if (task.status === "paused") {
    return (
      <div className={styles.headerActions}>
        <button onClick={onStop} className={styles.btnPrimary}>Stop</button>
        <button onClick={onResume} className={styles.btnGhost}>Resume</button>
        <button onClick={onDelete} className={styles.btnDanger}>Delete</button>
      </div>
    );
  }
  if (task.status === "complete") {
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

interface SessionAttemptSelectorProps {
  taskSessions: Session[];
  selectedSessionId: string | undefined;
  onSelect: (sessionId: string) => void;
}

function SessionAttemptSelector({ taskSessions, selectedSessionId, onSelect }: SessionAttemptSelectorProps): JSX.Element | undefined {
  if (taskSessions.length < 2) return undefined;
  return (
    <div className={styles.attemptSelector} data-testid="attempt-selector">
      <span className={styles.attemptLabel}>Attempts:</span>
      {taskSessions.map((s, i) => {
        const isActive = s.id === selectedSessionId;
        const statusIcon = s.status === "stopped" && s.endReason === "completed" ? "\u2713"
          : s.status === "stopped" ? "\u2717"
          : s.status === "running" || s.status === "idle" ? "\u25CF"
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

/** Task detail page with overview/stream/findings tabs. */
export function TaskPage(): JSX.Element {
  const { taskId, workspaceId: routeWorkspaceId, environmentId: routeEnvironmentId } = useParams<{ taskId: string; workspaceId?: string; environmentId?: string }>();
  const location = useLocation();
  const navigate = useAppNavigate();
  const {
    events, eventsDropped, tasks, sessions, environments,
    loadSessionEvents, loadFindings,
    kill, startTask, stopTask, resumeTask, deleteTask,
    workspaces, taskSessions: taskSessionsMap, loadTaskSessions,
  } = useGrackle();

  const loadedRef = useRef<string | undefined>(undefined);
  const prevTaskIdRef = useRef<string | undefined>(undefined);
  const prevTaskStatusRef = useRef<string | undefined>(undefined);
  const loadedTaskSessionsRef = useRef<string | undefined>(undefined);
  const prevTaskSessionIdRef = useRef<string | undefined>(undefined);

  // Derive tab from URL path
  const tabFromUrl: TaskTab =
    location.pathname.endsWith("/stream") ? "stream"
    : location.pathname.endsWith("/findings") ? "findings"
    : "overview";

  const [activeTaskTab, setActiveTaskTab] = useState<TaskTab>(tabFromUrl);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");

  // Sync tab with URL only when the URL-derived tab actually changes.
  // Use a ref to avoid fighting with the auto-switch-by-status logic.
  const prevTabFromUrlRef = useRef(tabFromUrl);
  if (tabFromUrl !== prevTabFromUrlRef.current) {
    prevTabFromUrlRef.current = tabFromUrl;
    if (tabFromUrl !== activeTaskTab) {
      setActiveTaskTab(tabFromUrl);
    }
  }

  const task = tasks.find((t) => t.id === taskId);
  const workspaceId = task?.workspaceId || undefined;
  const workspace = workspaces.find((p) => p.id === workspaceId);

  // Initialize env selector from workspace default when task/workspace loads
  useEffect(() => {
    if (selectedEnvId !== "") return;
    if (workspace?.environmentId) {
      setSelectedEnvId(workspace.environmentId);
    } else if (environments.length > 0) {
      const connected = environments.find((e) => e.status === "connected");
      setSelectedEnvId(connected?.id ?? environments[0].id);
    }
  }, [selectedEnvId, workspace?.environmentId, environments]);

  // Resolve effective sessionId from the task's eagerly-patched latestSessionId
  // (set by the task_started handler) or from the user's attempt selection.
  const currentTaskSessions = task ? (taskSessionsMap[task.id] ?? []) : [];
  let sessionId: string | undefined = undefined;
  if (selectedSessionId && currentTaskSessions.some((s) => s.id === selectedSessionId)) {
    sessionId = selectedSessionId;
  } else {
    sessionId = task?.latestSessionId || undefined;
  }

  const handleDeleteTask = (): void => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = (): void => {
    if (!task) return;
    deleteTask(task.id);
    setShowDeleteConfirm(false);
    const envId = routeEnvironmentId ?? workspace?.environmentId;
    navigate(task.workspaceId && envId ? workspaceUrl(task.workspaceId, envId) : "/", { replace: true });
  };

  // Reset state when switching tasks
  if (task?.id !== prevTaskIdRef.current) {
    prevTaskIdRef.current = task?.id;
    if (selectedSessionId !== undefined) {
      setSelectedSessionId(undefined);
    }
    if (selectedEnvId !== "") {
      setSelectedEnvId("");
    }
  }

  // Load task sessions
  useEffect(() => {
    if (!task?.id) return;
    const isNewTask = task.id !== loadedTaskSessionsRef.current;
    const sessionChanged = task.latestSessionId !== prevTaskSessionIdRef.current;
    if (isNewTask || sessionChanged) {
      loadedTaskSessionsRef.current = task.id;
      prevTaskSessionIdRef.current = task.latestSessionId;
      loadTaskSessions(task.id);
    }
  }, [task?.id, task?.latestSessionId, loadTaskSessions]);

  // Auto-switch tab based on task status.
  // Skip the initial status transition (undefined → first status) when the URL
  // explicitly targets a non-default tab, so deep links like /tasks/:id/stream
  // are not overridden by the status-based auto-switch.
  if (task?.status !== prevTaskStatusRef.current) {
    const isInitialLoad = prevTaskStatusRef.current === undefined;
    prevTaskStatusRef.current = task?.status;
    const newTab: TaskTab | undefined =
      task?.status === "not_started" ? "overview"
      : task?.status === "working" ? "stream"
      : task?.status === "paused" ? "stream"
      : task?.status === "complete" ? "findings"
      : undefined;
    if (newTab && newTab !== activeTaskTab && !(isInitialLoad && tabFromUrl !== "overview")) {
      setActiveTaskTab(newTab);
    }
  }

  const tasksById = useMemo(
    () => new Map(tasks.map((t) => [t.id, t])),
    [tasks],
  );

  const groupedEvents = useMemo(() => {
    const filtered = sessionId
      ? events.filter((e) => e.sessionId === sessionId)
      : [];
    return pairToolEvents(groupConsecutiveTextEvents(filtered));
  }, [events, sessionId]);

  const isTaskBlocked = task
    ? task.dependsOn.some((depId) => {
        const dep = tasksById.get(depId);
        return dep !== undefined && dep.status !== "complete";
      })
    : false;

  const breadcrumbs = useMemo(
    () => buildTaskBreadcrumbs(taskId!, routeEnvironmentId, workspaces, environments, tasksById),
    [taskId, routeEnvironmentId, workspaces, environments, tasksById],
  );

  // Load historical events when the session changes. The session_events
  // reducer merges/dedupes replay events with real-time events, so it's
  // always safe to request replay.
  useEffect(() => {
    if (sessionId && sessionId !== loadedRef.current) {
      loadedRef.current = sessionId;
      loadSessionEvents(sessionId);
    }
  }, [sessionId, loadSessionEvents]);

  // Load findings when switching to findings tab
  useEffect(() => {
    if (activeTaskTab === "findings" && workspaceId) {
      loadFindings(workspaceId);
    }
  }, [activeTaskTab, workspaceId, loadFindings]);

  const handleTabChange = (tab: TaskTab): void => {
    setActiveTaskTab(tab);
    navigate(taskUrl(taskId!, tab === "overview" ? undefined : tab, routeWorkspaceId, routeEnvironmentId));
  };

  return (
    <div className={styles.panelContainer}>
      <Breadcrumbs segments={breadcrumbs} />
      {/* Task header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          <span data-testid="task-title">{task?.title || taskId}</span>
          {task && <span className={styles.taskStatusBadge} data-testid="task-status">{task.status}</span>}
          {task?.branch && <span className={styles.taskBranch}>{task.branch}</span>}
          {isTaskBlocked && <span className={styles.taskBlockedBadge}>blocked</span>}
        </span>
        {task && (
          <TaskActionButtons
            task={task}
            sessionId={sessionId}
            isBlocked={isTaskBlocked}
            onStart={() => startTask(task.id, undefined, selectedEnvId)}
            onResume={() => resumeTask(task.id)}
            onStop={() => stopTask(task.id)}
            onPause={() => sessionId && kill(sessionId)}
            onDelete={handleDeleteTask}
            onEdit={() => navigate(taskEditUrl(task.id, routeWorkspaceId, routeEnvironmentId))}
          />
        )}
      </div>

      {/* Tab bar */}
      <div className={styles.tabBar} role="tablist" aria-label="Task view">
        <button role="tab" aria-selected={activeTaskTab === "overview"} className={`${styles.tab} ${activeTaskTab === "overview" ? styles.active : ""}`} onClick={() => handleTabChange("overview")}>
          Overview
        </button>
        <button role="tab" aria-selected={activeTaskTab === "stream"} className={`${styles.tab} ${activeTaskTab === "stream" ? styles.active : ""}`} onClick={() => handleTabChange("stream")}>
          Stream
        </button>
        <button role="tab" aria-selected={activeTaskTab === "findings"} className={`${styles.tab} ${activeTaskTab === "findings" ? styles.active : ""}`} onClick={() => handleTabChange("findings")}>
          Findings
        </button>
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {activeTaskTab === "overview" && (
          <motion.div key="overview" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className={styles.overviewContent} data-testid="task-overview">
            {task ? (
              <TaskOverview task={task} tasksById={tasksById} environments={environments} workspaces={workspaces} taskSessions={currentTaskSessions} selectedEnvId={selectedEnvId} />
            ) : (
              <div className={styles.waitingMessage}>No additional details</div>
            )}
          </motion.div>
        )}
        {activeTaskTab === "stream" && (
          <motion.div key="stream" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            <SessionAttemptSelector taskSessions={currentTaskSessions} selectedSessionId={sessionId} onSelect={(id) => setSelectedSessionId(id)} />
            <EventStream
              events={groupedEvents}
              eventsDropped={eventsDropped}
              emptyState={
                !sessionId && task ? (
                  <div className={styles.emptyCta}>
                    <button className={styles.ctaButton} onClick={() => startTask(task.id, undefined, selectedEnvId)}>Start Task</button>
                    <div className={styles.ctaDescription}>Click to begin agent execution</div>
                  </div>
                ) : sessionId && groupedEvents.length === 0 ? (
                  <div className={styles.waitingMessage}>Waiting for events...</div>
                ) : undefined
              }
            />
          </motion.div>
        )}
        {activeTaskTab === "findings" && (
          <motion.div key="findings" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className={styles.tabContent}>
            {workspaceId ? (
              <FindingsPanel workspaceId={workspaceId} />
            ) : (
              <div className={styles.noContext}>Navigate to a task within a workspace to view findings</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {(() => {
        if (!task || (task.status !== "working" && task.status !== "paused")) {
          return undefined;
        }
        const taskSessionForChat = sessionId
          ? sessions.find((s) => s.id === sessionId)
          : undefined;
        if (!taskSessionForChat || taskSessionForChat.status === "stopped") {
          return undefined;
        }
        return (
          <ChatInput
            mode="send"
            sessionId={taskSessionForChat.id}
            environmentId={taskSessionForChat.environmentId}
          />
        );
      })()}
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
