import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useParams, useLocation } from "react-router";
import { useGrackle } from "../context/GrackleContext.js";
import {
  Breadcrumbs, ChatInput, ConfirmDialog, EventStream, FindingsPanel,
  SessionAttemptSelector, TaskActionButtons, TaskEditPanel, TaskOverviewPanel,
  buildTaskBreadcrumbs, groupConsecutiveTextEvents, pairToolEvents,
  taskUrl, useAppNavigate, useToast, workspaceUrl,
} from "@grackle-ai/web-components";
import type { UsageStats } from "@grackle-ai/web-components";
import { AnimatePresence, motion } from "motion/react";
import { useHotkey } from "../hooks/useHotkey.js";
import { TaskShimmer } from "./TaskShimmer.js";
import styles from "./page-layout.module.scss";

type TaskTab = "overview" | "stream" | "findings";

/** Task detail page with overview/stream/findings tabs. */
export function TaskPage(): JSX.Element {
  const { taskId, workspaceId: routeWorkspaceId, environmentId: routeEnvironmentId } = useParams<{ taskId: string; workspaceId?: string; environmentId?: string }>();
  const location = useLocation();
  const navigate = useAppNavigate();
  const { showToast } = useToast();
  const {
    sessions: { events, eventsDropped, sessions, loadSessionEvents, taskSessions: taskSessionsMap, loadTaskSessions, sendInput, spawn, kill },
    tasks: { tasks, tasksLoading, startTask, stopTask, resumeTask, deleteTask, createTask, updateTask },
    environments: { environments, provisionEnvironment },
    findings: { findings, loadFindings },
    workspaces: { workspaces },
    personas: { personas },
    usageCache, loadUsage,
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
  const isEditRoute = location.pathname.endsWith("/edit");

  const [activeTaskTab, setActiveTaskTab] = useState<TaskTab>(tabFromUrl);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(isEditRoute);

  const prevTabFromUrlRef = useRef(tabFromUrl);
  const prevIsEditRouteRef = useRef(isEditRoute);

  const task = tasks.find((t) => t.id === taskId);
  const workspaceId = task?.workspaceId || undefined;
  const workspace = workspaces.find((p) => p.id === workspaceId);

  // Sync tab with URL only when the URL-derived tab actually changes.
  // Use a ref to avoid fighting with the auto-switch-by-status logic.
  useEffect(() => {
    if (tabFromUrl !== prevTabFromUrlRef.current) {
      prevTabFromUrlRef.current = tabFromUrl;
      if (tabFromUrl !== activeTaskTab) {
        setActiveTaskTab(tabFromUrl);
      }
    }
  }, [tabFromUrl, activeTaskTab]);

  useEffect(() => {
    if (isEditRoute !== prevIsEditRouteRef.current) {
      prevIsEditRouteRef.current = isEditRoute;
      if (isEditRoute !== isEditing) {
        setIsEditing(isEditRoute);
      }
    }
  }, [isEditRoute, isEditing]);

  // Initialize env selector from workspace default when task/workspace loads
  useEffect(() => {
    if (selectedEnvId !== "") {
      return;
    }
    if (workspace?.linkedEnvironmentIds[0]) {
      setSelectedEnvId(workspace.linkedEnvironmentIds[0]);
    } else if (environments.length > 0) {
      const connected = environments.find((e) => e.status === "connected");
      setSelectedEnvId(connected?.id ?? environments[0].id);
    }
  }, [selectedEnvId, workspace?.linkedEnvironmentIds[0], environments]);

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
    if (!task) {
      return;
    }
    deleteTask(task.id).catch(() => {});
    setShowDeleteConfirm(false);
    const envId = routeEnvironmentId ?? workspace?.linkedEnvironmentIds[0];
    navigate(task.workspaceId && envId ? workspaceUrl(task.workspaceId, envId) : "/", { replace: true });
  };

  // Reset state when switching tasks
  useEffect(() => {
    if (task?.id !== prevTaskIdRef.current) {
      prevTaskIdRef.current = task?.id;
      setSelectedSessionId(undefined);
      setSelectedEnvId("");
      setIsEditing(isEditRoute);
    }
  }, [task?.id, isEditRoute]);

  // Load task sessions
  useEffect(() => {
    if (!task?.id) {
      return;
    }
    const isNewTask = task.id !== loadedTaskSessionsRef.current;
    const sessionChanged = task.latestSessionId !== prevTaskSessionIdRef.current;
    if (isNewTask || sessionChanged) {
      loadedTaskSessionsRef.current = task.id;
      prevTaskSessionIdRef.current = task.latestSessionId;
      loadTaskSessions(task.id).catch(() => {});
    }
  }, [task?.id, task?.latestSessionId, loadTaskSessions]);

  // Auto-switch tab based on task status.
  // Skip the initial status transition (undefined -> first status) when the URL
  // explicitly targets a non-default tab, so deep links like /tasks/:id/stream
  // are not overridden by the status-based auto-switch.
  useEffect(() => {
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
  }, [task?.status, activeTaskTab, tabFromUrl]);

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
      loadSessionEvents(sessionId).catch(() => {});
    }
  }, [sessionId, loadSessionEvents]);

  // Load findings when switching to findings tab
  useEffect(() => {
    if (activeTaskTab === "findings" && workspaceId) {
      loadFindings(workspaceId).catch(() => {});
    }
  }, [activeTaskTab, workspaceId, loadFindings]);

  // Load usage stats for the overview panel (lifted from the old inline TaskOverview)
  const sessionCostSum = currentTaskSessions.reduce((s, sess) => s + (sess.costMillicents ?? 0), 0);
  useEffect(() => {
    if (!task) {
      return;
    }
    loadUsage("task", task.id).catch(() => {});
    if (task.childTaskIds.length > 0) {
      loadUsage("task_tree", task.id).catch(() => {});
    }
  }, [task?.id, task?.childTaskIds.length, loadUsage, sessionCostSum]);

  const taskUsageKey = task ? `task:${task.id}` : "";
  const taskUsage: UsageStats | undefined = taskUsageKey in usageCache ? usageCache[taskUsageKey] : undefined;
  const treeUsageKey = task ? `task_tree:${task.id}` : "";
  const treeUsage: UsageStats | undefined = task && task.childTaskIds.length > 0 && treeUsageKey in usageCache ? usageCache[treeUsageKey] : undefined;

  const handleTabChange = (tab: TaskTab): void => {
    setActiveTaskTab(tab);
    navigate(taskUrl(taskId!, tab === "overview" ? undefined : tab, routeWorkspaceId, routeEnvironmentId));
  };

  // Keyboard shortcuts: 1/2/3 to switch tabs
  useHotkey({ key: "1" }, () => handleTabChange("overview"));
  useHotkey({ key: "2" }, () => handleTabChange("stream"));
  useHotkey({ key: "3" }, () => handleTabChange("findings"));

  if (!task && tasksLoading) {
    return <TaskShimmer />;
  }

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
            onStart={() => { startTask(task.id, undefined, selectedEnvId).catch(() => {}); }}
            onResume={() => { resumeTask(task.id).catch(() => {}); }}
            onStop={() => { stopTask(task.id).catch(() => {}); }}
            onPause={() => { if (sessionId) { kill(sessionId).catch(() => {}); } }}
            onDelete={handleDeleteTask}
            onEdit={() => setIsEditing(true)}
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
            {isEditing && task ? (
              <TaskEditPanel
                mode="edit"
                taskId={task.id}
                workspaceId={workspaceId}
                environmentId={routeEnvironmentId}
                tasks={tasks}
                workspaces={workspaces}
                personas={personas}
                onCreateTask={(wsId, title, desc, deps, parentId, personaId, canDecompose, onSuccess, onError) => { createTask(wsId, title, desc, deps, parentId, personaId, canDecompose, onSuccess, onError).catch(() => {}); }}
                onUpdateTask={(tid, title, desc, deps, personaId) => { updateTask(tid, title, desc, deps, personaId).catch(() => {}); }}
                onEditDone={() => {
                  if (isEditRoute) {
                    navigate(taskUrl(task.id, undefined, routeWorkspaceId, routeEnvironmentId), { replace: true });
                  } else {
                    setIsEditing(false);
                  }
                }}
                onShowToast={showToast}
              />
            ) : task ? (
              <TaskOverviewPanel
                task={task}
                tasksById={tasksById}
                environments={environments}
                workspaces={workspaces}
                taskSessions={currentTaskSessions}
                selectedEnvId={selectedEnvId}
                taskUsage={taskUsage}
                treeUsage={treeUsage}
              />
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
                  isTaskBlocked ? (
                    <div className={styles.emptyCta} data-testid="stream-blocked-message">
                      <div className={styles.ctaDescription}>This task is blocked by incomplete dependencies</div>
                    </div>
                  ) : (
                    <div className={styles.emptyCta}>
                      <button data-testid="stream-start-cta" className={styles.ctaButton} onClick={() => { startTask(task.id, undefined, selectedEnvId).catch(() => {}); }}>Start Task</button>
                      <div className={styles.ctaDescription}>Click to begin agent execution</div>
                    </div>
                  )
                ) : sessionId && groupedEvents.length === 0 ? (
                  <div className={styles.waitingMessage}>Waiting for events...</div>
                ) : undefined
              }
              onShowToast={showToast}
            />
          </motion.div>
        )}
        {activeTaskTab === "findings" && (
          <motion.div key="findings" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className={styles.tabContent}>
            {workspaceId ? (
              <FindingsPanel findings={findings.filter((f) => f.workspaceId === workspaceId)} />
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
            personas={personas}
            environments={environments}
            onSendInput={(sid, text) => { sendInput(sid, text).catch(() => { showToast("Failed to send message", "error"); }); }}
            onSpawn={(eid, prompt, pid) => { spawn(eid, prompt, pid).catch(() => {}); }}
            onStartTask={(tid, pid, eid) => { startTask(tid, pid, eid).catch(() => {}); }}
            onProvisionEnvironment={(eid) => { provisionEnvironment(eid).catch(() => {}); }}
            onShowToast={showToast}
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
