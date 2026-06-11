import { useEffect, useRef, useState, type JSX } from "react";
import { useParams, useLocation } from "react-router";
import { extractErrorMessage } from "../hooks/grackleError.js";
import { useSandboxProxyUrl } from "../context/ManifestContext.js";
import {
  ChatInput,
  ConfirmDialog,
  EventStream,
  SessionAttemptSelector,
  TaskActionButtons,
  PageHeader,
  TaskEditPanel,
  TaskOverviewPanel,
  taskUrl,
  useAppNavigate,
  useToast,
  workspaceUrl,
} from "@grackle-ai/web-components";
import { AnimatePresence, motion } from "motion/react";
import { useHotkey } from "../hooks/useHotkey.js";
import { useTaskPageData } from "../hooks/useTaskPageData.js";
import { TaskShimmer } from "./TaskShimmer.js";
import styles from "./page-layout.module.scss";

type TaskTab = "overview" | "stream";

/** Task detail page with overview/stream tabs. */
export function TaskPage(): JSX.Element {
  const {
    taskId,
    workspaceId: routeWorkspaceId,
    environmentId: routeEnvironmentId,
  } = useParams<{ taskId: string; workspaceId?: string; environmentId?: string }>();
  const sandboxProxyUrl = useSandboxProxyUrl();
  const location = useLocation();
  const navigate = useAppNavigate();
  const { showToast } = useToast();

  // Derive tab from URL path
  const tabFromUrl: TaskTab = location.pathname.endsWith("/stream") ? "stream" : "overview";
  const isEditRoute = location.pathname.endsWith("/edit");

  // ── Data hook ─────────────────────────────────────────────────
  const {
    tasksLoading,
    task,
    workspaceId,
    tasks,
    workspaces,
    personas,
    environments,
    sessions,
    eventsDropped,
    tasksById,
    currentTaskSessions,
    sessionId,
    docEnvironmentId,
    groupedEvents,
    isTaskBlocked,
    breadcrumbs,
    taskUsage,
    treeUsage,
    setSelectedSessionId,
    selectedEnvId,
    actions,
  } = useTaskPageData({ taskId, routeEnvironmentId, isEditRoute });

  // ── URL / UI state (stays in the page — coupled to navigation) ─

  const [activeTaskTab, setActiveTaskTab] = useState<TaskTab>(tabFromUrl);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState<boolean>(isEditRoute);

  const prevTabFromUrlRef = useRef(tabFromUrl);
  const prevIsEditRouteRef = useRef(isEditRoute);
  const prevTaskStatusRef = useRef<string | undefined>(undefined);
  const prevTaskIdForEditRef = useRef<string | undefined>(undefined);

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

  // Reset isEditing when switching to a different task
  useEffect(() => {
    if (task?.id !== prevTaskIdForEditRef.current) {
      prevTaskIdForEditRef.current = task?.id;
      setIsEditing(isEditRoute);
    }
  }, [task?.id, isEditRoute]);

  // Auto-switch tab based on task status.
  // Skip the initial status transition (undefined -> first status) when the URL
  // explicitly targets a non-default tab, so deep links like /tasks/:id/stream
  // are not overridden by the status-based auto-switch.
  useEffect(() => {
    if (task?.status !== prevTaskStatusRef.current) {
      const isInitialLoad = prevTaskStatusRef.current === undefined;
      prevTaskStatusRef.current = task?.status;
      const newTab: TaskTab | undefined =
        task?.status === "not_started"
          ? "overview"
          : task?.status === "working"
            ? "stream"
            : task?.status === "paused"
              ? "stream"
              : task?.status === "complete"
                ? "overview"
                : undefined;
      if (newTab && newTab !== activeTaskTab && !(isInitialLoad && tabFromUrl !== "overview")) {
        setActiveTaskTab(newTab);
      }
    }
  }, [task?.status, activeTaskTab, tabFromUrl]);

  // ── Navigation-coupled handlers ───────────────────────────────

  const handleDeleteTask = (): void => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = (): void => {
    if (!task) {
      return;
    }
    actions.deleteTask(task.id).catch(() => {});
    setShowDeleteConfirm(false);
    const envId =
      routeEnvironmentId ?? workspaces.find((w) => w.id === workspaceId)?.linkedEnvironmentIds[0];
    navigate(task.workspaceId && envId ? workspaceUrl(task.workspaceId, envId) : "/", {
      replace: true,
    });
  };

  const handleTabChange = (tab: TaskTab): void => {
    setActiveTaskTab(tab);
    navigate(
      taskUrl(taskId!, tab === "overview" ? undefined : tab, routeWorkspaceId, routeEnvironmentId),
    );
  };

  // Keyboard shortcuts: 1/2 to switch tabs
  useHotkey({ key: "1" }, () => handleTabChange("overview"));
  useHotkey({ key: "2" }, () => handleTabChange("stream"));

  if (!task && tasksLoading) {
    return <TaskShimmer />;
  }

  return (
    <div className={styles.panelContainer}>
      <PageHeader segments={breadcrumbs} />
      {/* Task header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          <span data-testid="task-title">{task?.title || taskId}</span>
          {task && (
            <span className={styles.taskStatusBadge} data-testid="task-status">
              {task.status}
            </span>
          )}
          {task?.branch && <span className={styles.taskBranch}>{task.branch}</span>}
          {isTaskBlocked && <span className={styles.taskBlockedBadge}>blocked</span>}
        </span>
        {task && (
          <TaskActionButtons
            task={task}
            sessionId={sessionId}
            // Resume gating must track the task's LATEST session — resumeTask
            // always reanimates that one, regardless of which attempt the user
            // has selected to view (#1356).
            latestSessionStatus={sessions.find((s) => s.id === task.latestSessionId)?.status}
            isBlocked={isTaskBlocked}
            onStart={() => {
              actions.startTask(task.id, undefined, selectedEnvId).catch((err) => {
                showToast(extractErrorMessage(err, "Failed to start task"), "error");
              });
            }}
            onResume={() => {
              actions.resumeTask(task.id).catch(() => {});
            }}
            onStop={() => {
              actions.stopTask(task.id).catch(() => {});
            }}
            onPause={() => {
              if (sessionId) {
                actions.kill(sessionId).catch(() => {});
              }
            }}
            onDelete={handleDeleteTask}
            onEdit={() => setIsEditing(true)}
          />
        )}
      </div>

      {/* Tab bar */}
      <div className={styles.tabBar} role="tablist" aria-label="Task view">
        <button
          role="tab"
          aria-selected={activeTaskTab === "overview"}
          className={`${styles.tab} ${activeTaskTab === "overview" ? styles.active : ""}`}
          onClick={() => handleTabChange("overview")}
        >
          Overview
        </button>
        <button
          role="tab"
          aria-selected={activeTaskTab === "stream"}
          className={`${styles.tab} ${activeTaskTab === "stream" ? styles.active : ""}`}
          onClick={() => handleTabChange("stream")}
        >
          Stream
        </button>
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        {activeTaskTab === "overview" && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className={styles.overviewContent}
            data-testid="task-overview"
          >
            {isEditing && task ? (
              <TaskEditPanel
                mode="edit"
                taskId={task.id}
                workspaceId={workspaceId}
                environmentId={routeEnvironmentId}
                tasks={tasks}
                workspaces={workspaces}
                personas={personas}
                onCreateTask={(
                  wsId,
                  title,
                  desc,
                  deps,
                  parentId,
                  personaId,
                  canDecompose,
                  injectKnowledge,
                  onSuccess,
                  onError,
                ) => {
                  actions
                    .createTask(
                      wsId,
                      title,
                      desc,
                      deps,
                      parentId,
                      personaId,
                      canDecompose,
                      injectKnowledge,
                      onSuccess,
                      onError,
                    )
                    .catch(() => {});
                }}
                onUpdateTask={(tid, title, desc, deps, personaId) => {
                  actions.updateTask(tid, title, desc, deps, personaId).catch(() => {});
                }}
                onEditDone={() => {
                  if (isEditRoute) {
                    navigate(taskUrl(task.id, undefined, routeWorkspaceId, routeEnvironmentId), {
                      replace: true,
                    });
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
              onSelect={(id) => setSelectedSessionId(id)}
            />
            <EventStream
              events={groupedEvents}
              eventsDropped={eventsDropped}
              sandboxProxyUrl={sandboxProxyUrl}
              emptyState={
                !sessionId && task ? (
                  isTaskBlocked ? (
                    <div className={styles.emptyCta} data-testid="stream-blocked-message">
                      <div className={styles.ctaDescription}>
                        This task is blocked by incomplete dependencies
                      </div>
                    </div>
                  ) : (
                    <div className={styles.emptyCta}>
                      <button
                        data-testid="stream-start-cta"
                        className={styles.ctaButton}
                        onClick={() => {
                          actions.startTask(task.id, undefined, selectedEnvId).catch((err) => {
                            showToast(extractErrorMessage(err, "Failed to start task"), "error");
                          });
                        }}
                      >
                        Start Task
                      </button>
                      <div className={styles.ctaDescription}>Click to begin agent execution</div>
                    </div>
                  )
                ) : sessionId && groupedEvents.length === 0 ? (
                  <div className={styles.waitingMessage}>Waiting for events...</div>
                ) : undefined
              }
              onShowToast={showToast}
              onOpenDocument={
                docEnvironmentId
                  ? (uri) =>
                      actions.openDocument(
                        { environmentId: docEnvironmentId, uri },
                        { focus: true },
                      )
                  : undefined
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
      {(() => {
        if (!task || (task.status !== "working" && task.status !== "paused")) {
          return undefined;
        }
        const taskSessionForChat = sessionId ? sessions.find((s) => s.id === sessionId) : undefined;
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
            onSendInput={(sid, text) => {
              actions.sendInput(sid, text).catch(() => {
                showToast("Failed to send message", "error");
              });
            }}
            onSpawn={(eid, prompt, pid) => {
              actions.spawn(eid, prompt, pid, undefined, workspaceId).catch(() => {});
            }}
            onStartTask={(tid, pid, eid) => {
              actions.startTask(tid, pid, eid).catch(() => {});
            }}
            onProvisionEnvironment={(eid) => {
              actions.provisionEnvironment(eid).catch(() => {});
            }}
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
