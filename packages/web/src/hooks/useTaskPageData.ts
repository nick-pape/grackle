import { useEffect, useMemo, useRef, useState } from "react";
import { useGrackle } from "../context/GrackleContext.js";
import {
  buildTaskBreadcrumbs,
  groupConsecutiveTextEvents,
  pairToolEvents,
} from "@grackle-ai/web-components";
import type { TaskData, UsageStats } from "@grackle-ai/web-components";

// Derive action types directly from the grackle context so signatures never drift.
type GrackleResult = ReturnType<typeof useGrackle>;

/** Domain actions exposed by the useTaskPageData hook. */
export interface TaskPageActions {
  /** Start the task with an optional environment. */
  startTask: GrackleResult["tasks"]["startTask"];
  /** Resume the paused task. */
  resumeTask: GrackleResult["tasks"]["resumeTask"];
  /** Stop/cancel the running task. */
  stopTask: GrackleResult["tasks"]["stopTask"];
  /** Delete the task. */
  deleteTask: GrackleResult["tasks"]["deleteTask"];
  /** Create a subtask or related task. */
  createTask: GrackleResult["tasks"]["createTask"];
  /** Update the task's fields. */
  updateTask: GrackleResult["tasks"]["updateTask"];
  /** Send a chat message to the active session. */
  sendInput: GrackleResult["sessions"]["sendInput"];
  /** Spawn a new session. */
  spawn: GrackleResult["sessions"]["spawn"];
  /** Kill a session. */
  kill: GrackleResult["sessions"]["kill"];
  /** Provision an environment for use. */
  provisionEnvironment: GrackleResult["environments"]["provisionEnvironment"];
  /** Open a document in the environment. */
  openDocument: GrackleResult["documents"]["openDocument"];
}

/** Input parameters for the useTaskPageData hook. */
export interface UseTaskPageDataInput {
  /** Task ID from the route (undefined until params are resolved). */
  taskId: string | undefined;
  /** Environment ID from the route, if present. */
  routeEnvironmentId: string | undefined;
  /** Whether the current URL ends with "/edit" (used to gate the task-reset effect). */
  isEditRoute: boolean;
}

/** All data, state, and actions returned by useTaskPageData. */
export interface UseTaskPageDataResult {
  // ── Loading ──────────────────────────────────────────────────
  /** Whether the tasks list is still loading. */
  tasksLoading: boolean;

  // ── Core entities ─────────────────────────────────────────────
  /** The current task, or undefined if not yet found. */
  task: TaskData | undefined;
  /** Workspace ID for the task. */
  workspaceId: string | undefined;
  /** All tasks (needed for TaskEditPanel's dep selector). */
  tasks: GrackleResult["tasks"]["tasks"];
  /** All workspaces. */
  workspaces: GrackleResult["workspaces"]["workspaces"];
  /** All personas. */
  personas: GrackleResult["personas"]["personas"];
  /** All environments. */
  environments: GrackleResult["environments"]["environments"];
  /** All active sessions. */
  sessions: GrackleResult["sessions"]["sessions"];
  /** Count of stream events dropped due to ring-buffer overflow (0 when none). */
  eventsDropped: number;

  // ── Derived ───────────────────────────────────────────────────
  /** Task ID map for dependency resolution. */
  tasksById: Map<string, TaskData>;
  /** Sessions for the current task, from the task-sessions map. */
  currentTaskSessions: GrackleResult["sessions"]["taskSessions"][string];
  /** Effective session ID (user selection or latest from task). */
  sessionId: string | undefined;
  /** Environment ID to resolve opened document URIs against. */
  docEnvironmentId: string | undefined;
  /** Paired + grouped event stream for the active session. */
  groupedEvents: ReturnType<typeof pairToolEvents>;
  /** Whether the task is blocked by incomplete dependencies. */
  isTaskBlocked: boolean;
  /** Breadcrumb segments for the page header. */
  breadcrumbs: ReturnType<typeof buildTaskBreadcrumbs>;
  /** Usage stats for the task itself. */
  taskUsage: UsageStats | undefined;
  /** Aggregated usage stats for the task's subtree. */
  treeUsage: UsageStats | undefined;

  // ── Selection state ──────────────────────────────────────────
  /** Currently selected session attempt ID (overrides latestSessionId). */
  selectedSessionId: string | undefined;
  /** Update the selected session. */
  setSelectedSessionId: (id: string | undefined) => void;
  /** Currently selected environment ID for task start. */
  selectedEnvId: string;
  /** Update the selected environment. */
  setSelectedEnvId: (id: string) => void;

  // ── Domain actions ────────────────────────────────────────────
  /** Bound domain actions that forward to the gRPC layer. */
  actions: TaskPageActions;
}

/**
 * Data-wiring hook for TaskPage. Centralises all useGrackle() destructuring,
 * data-loading effects, and derived state so the page component can focus on
 * rendering and URL/UI state.
 *
 * Must only be used inside a page component (useGrackle() constraint).
 */
export function useTaskPageData({
  taskId,
  routeEnvironmentId,
  isEditRoute,
}: UseTaskPageDataInput): UseTaskPageDataResult {
  const {
    sessions: {
      events,
      eventsDropped,
      sessions,
      loadSessionEvents,
      taskSessions: taskSessionsMap,
      loadTaskSessions,
      sendInput,
      spawn,
      kill,
    },
    tasks: {
      tasks,
      tasksLoading,
      startTask,
      stopTask,
      resumeTask,
      deleteTask,
      createTask,
      updateTask,
    },
    environments: { environments, provisionEnvironment },
    workspaces: { workspaces },
    personas: { personas },
    documents: { openDocument },
    usageCache,
    loadUsage,
  } = useGrackle();

  // ── Refs ──────────────────────────────────────────────────────

  const loadedRef = useRef<string | undefined>(undefined);
  const prevTaskIdRef = useRef<string | undefined>(undefined);
  const loadedTaskSessionsRef = useRef<string | undefined>(undefined);
  const prevTaskSessionIdRef = useRef<string | undefined>(undefined);

  // ── Selection state ───────────────────────────────────────────

  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");

  // ── Core entity derivation ────────────────────────────────────

  const task = tasks.find((t) => t.id === taskId);
  const workspaceId = task?.workspaceId ?? undefined;
  const workspace = workspaces.find((p) => p.id === workspaceId);

  // ── Effects ───────────────────────────────────────────────────

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

  // Reset selection state when switching to a different task
  useEffect(() => {
    if (task?.id !== prevTaskIdRef.current) {
      prevTaskIdRef.current = task?.id;
      setSelectedSessionId(undefined);
      setSelectedEnvId("");
    }
  }, [task?.id, isEditRoute]);

  // Load task sessions when the task or its latest session changes
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

  // ── Derived session resolution ────────────────────────────────

  const currentTaskSessions = task ? (taskSessionsMap[task.id] ?? []) : [];

  let sessionId: string | undefined = undefined;
  if (selectedSessionId && currentTaskSessions.some((s) => s.id === selectedSessionId)) {
    sessionId = selectedSessionId;
  } else {
    sessionId = task?.latestSessionId ?? undefined;
  }

  // Environment to resolve clicked filepaths against: the shown session's env,
  // else the selected start-env (#1396).
  const docEnvironmentId: string | undefined =
    (sessionId ? sessions.find((s) => s.id === sessionId)?.environmentId : undefined) ??
    (selectedEnvId !== "" ? selectedEnvId : undefined);

  // Load historical events when the session changes. The session_events
  // reducer merges/dedupes replay events with real-time events, so it's
  // always safe to request replay.
  useEffect(() => {
    if (sessionId && sessionId !== loadedRef.current) {
      loadedRef.current = sessionId;
      loadSessionEvents(sessionId).catch(() => {});
    }
  }, [sessionId, loadSessionEvents]);

  // ── Derived data ──────────────────────────────────────────────

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const groupedEvents = useMemo(() => {
    const filtered = sessionId ? events.filter((e) => e.sessionId === sessionId) : [];
    return pairToolEvents(groupConsecutiveTextEvents(filtered));
  }, [events, sessionId]);

  const isTaskBlocked = task
    ? task.dependsOn.some((depId) => {
        const dep = tasksById.get(depId);
        return dep !== undefined && dep.status !== "complete";
      })
    : false;

  const breadcrumbs = useMemo(
    () =>
      buildTaskBreadcrumbs(taskId ?? "", routeEnvironmentId, workspaces, environments, tasksById),
    [taskId, routeEnvironmentId, workspaces, environments, tasksById],
  );

  // ── Usage loading ─────────────────────────────────────────────

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
  const taskUsage: UsageStats | undefined =
    taskUsageKey in usageCache ? usageCache[taskUsageKey] : undefined;
  const treeUsageKey = task ? `task_tree:${task.id}` : "";
  const treeUsage: UsageStats | undefined =
    task && task.childTaskIds.length > 0 && treeUsageKey in usageCache
      ? usageCache[treeUsageKey]
      : undefined;

  // ── Actions ───────────────────────────────────────────────────

  const actions = useMemo<TaskPageActions>(
    () => ({
      startTask,
      resumeTask,
      stopTask,
      deleteTask,
      createTask,
      updateTask,
      sendInput,
      spawn,
      kill,
      provisionEnvironment,
      openDocument,
    }),
    [
      startTask,
      resumeTask,
      stopTask,
      deleteTask,
      createTask,
      updateTask,
      sendInput,
      spawn,
      kill,
      provisionEnvironment,
      openDocument,
    ],
  );

  return {
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
    selectedSessionId,
    setSelectedSessionId,
    selectedEnvId,
    setSelectedEnvId,
    actions,
  };
}
