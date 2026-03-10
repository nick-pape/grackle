import { useState, useEffect, useCallback, useRef } from "react";

export interface Environment {
  id: string;
  displayName: string;
  adapterType: string;
  defaultRuntime: string;
  status: string;
  bootstrapped: boolean;
}

export interface Session {
  id: string;
  environmentId: string;
  runtime: string;
  status: string;
  prompt: string;
  startedAt: string;
}

export interface SessionEvent {
  sessionId: string;
  eventType: string;
  timestamp: string;
  content: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  defaultEnvironmentId: string;
  status: string;
  createdAt: string;
}

export interface TaskData {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  branch: string;
  environmentId: string;
  sessionId: string;
  dependsOn: string[];
  reviewNotes: string;
  sortOrder: number;
  createdAt: string;
}

export interface FindingData {
  id: string;
  projectId: string;
  taskId: string;
  sessionId: string;
  category: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
}

export interface TaskDiffData {
  taskId: string;
  branch?: string;
  diff?: string;
  changedFiles?: string[];
  additions?: number;
  deletions?: number;
  error?: string;
}

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
}

const WS_RECONNECT_DELAY_MS: number = 3_000;
const ENV_POLL_INTERVAL_MS: number = 10_000;
/** Maximum number of events kept in memory per hook instance. Older events are dropped. */
const MAX_EVENTS: number = 5_000;

// Declare the injected API key from server-side HTML injection
declare global {
  interface Window {
    __GRACKLE_API_KEY__?: string;
  }
}

/** Provisioning progress state for a single environment. */
export interface ProvisionStatus {
  stage: string;
  message: string;
  progress: number;
}

/** Return type for the useGrackleSocket hook. */
export interface UseGrackleSocketResult {
  connected: boolean;
  environments: Environment[];
  sessions: Session[];
  events: SessionEvent[];
  lastSpawnedId: string | undefined;
  projects: Project[];
  tasks: TaskData[];
  findings: FindingData[];
  taskDiff: TaskDiffData | undefined;
  spawn: (
    environmentId: string,
    prompt: string,
    model?: string,
    runtime?: string,
  ) => void;
  sendInput: (sessionId: string, text: string) => void;
  kill: (sessionId: string) => void;
  refresh: () => void;
  loadSessionEvents: (sessionId: string) => void;
  clearEvents: () => void;
  createProject: (
    name: string,
    description?: string,
    repoUrl?: string,
    defaultEnvironmentId?: string,
  ) => void;
  archiveProject: (projectId: string) => void;
  loadTasks: (projectId: string) => void;
  createTask: (
    projectId: string,
    title: string,
    description?: string,
    environmentId?: string,
    dependsOn?: string[],
  ) => void;
  startTask: (taskId: string, runtime?: string, model?: string) => void;
  approveTask: (taskId: string) => void;
  rejectTask: (taskId: string, reviewNotes: string) => void;
  deleteTask: (taskId: string) => void;
  loadFindings: (projectId: string) => void;
  postFinding: (
    projectId: string,
    title: string,
    content: string,
    category?: string,
    tags?: string[],
  ) => void;
  loadTaskDiff: (taskId: string) => void;
  provisionStatus: Record<string, ProvisionStatus>;
  provisionEnvironment: (environmentId: string) => void;
  stopEnvironment: (environmentId: string) => void;
  removeEnvironment: (environmentId: string) => void;
}

export function useGrackleSocket(url?: string): UseGrackleSocketResult {
  const apiKey =
    typeof window !== "undefined" ? window.__GRACKLE_API_KEY__ || "" : "";
  const wsUrl =
    url ||
    (typeof window !== "undefined"
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}?token=${encodeURIComponent(apiKey)}`
      : "ws://localhost:3000");

  const wsRef = useRef<WebSocket | undefined>(undefined);
  const [connected, setConnected] = useState(false);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [lastSpawnedId, setLastSpawnedId] = useState<string | undefined>(
    undefined,
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [findings, setFindings] = useState<FindingData[]>([]);
  const [taskDiff, setTaskDiff] = useState<TaskDiffData | undefined>(undefined);
  const [provisionStatus, setProvisionStatus] = useState<Record<string, ProvisionStatus>>({});

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let envPollTimer: ReturnType<typeof setInterval>;

    function connect(): void {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        send({ type: "list_environments" });
        send({ type: "list_sessions" });
        send({ type: "list_projects" });
        send({ type: "subscribe_all" });
        // Periodically refresh environments to catch CLI-driven changes
        clearInterval(envPollTimer);
        envPollTimer = setInterval(() => {
          send({ type: "list_environments" });
        }, ENV_POLL_INTERVAL_MS);
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as WsMessage;
        switch (msg.type) {
          case "environments":
            setEnvironments((msg.payload?.environments as Environment[]) || []);
            break;
          case "sessions":
            setSessions((msg.payload?.sessions as Session[]) || []);
            break;
          case "session_event": {
            const event = msg.payload as unknown as SessionEvent;
            setEvents((prev) => {
              const next = [...prev, event];
              return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
            });
            if (event.eventType === "status") {
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === event.sessionId
                    ? { ...s, status: event.content }
                    : s,
                ),
              );
            }
            break;
          }
          case "session_events": {
            const replayEvents = msg.payload?.events as
              | SessionEvent[]
              | undefined;
            const replaySessionId = msg.payload?.sessionId as string;
            if (replayEvents && replaySessionId) {
              setEvents((prev) => {
                const without = prev.filter(
                  (e) => e.sessionId !== replaySessionId,
                );
                return [...without, ...replayEvents];
              });
            }
            break;
          }
          case "spawned": {
            const spawnedId = msg.payload?.sessionId as string;
            if (spawnedId) {
              setLastSpawnedId(spawnedId);
            }
            send({ type: "list_sessions" });
            send({ type: "list_environments" });
            break;
          }
          case "projects":
            setProjects((msg.payload?.projects as Project[]) || []);
            break;
          case "project_created":
            send({ type: "list_projects" });
            break;
          case "project_archived":
            send({ type: "list_projects" });
            break;
          case "tasks": {
            const incoming = (msg.payload?.tasks as TaskData[]) || [];
            const pid =
              (msg.payload?.projectId as string) ||
              (incoming.length > 0 ? incoming[0].projectId : "");
            if (!pid) {
              setTasks(incoming);
              break;
            }
            setTasks((prev) => [
              ...prev.filter((t) => t.projectId !== pid),
              ...incoming,
            ]);
            break;
          }
          case "task_created": {
            const taskData =
              (msg.payload?.task as Record<string, unknown>) || {};
            const pid = (taskData.project_id || taskData.projectId) as string;
            if (pid) send({ type: "list_tasks", payload: { projectId: pid } });
            break;
          }
          case "task_started": {
            const tp = msg.payload as Record<string, unknown>;
            if (tp.sessionId) {
              send({ type: "list_sessions" });
            }
            // Refresh tasks for the project
            const startedPid = tp.projectId as string | undefined;
            if (startedPid) {
              send({ type: "list_tasks", payload: { projectId: startedPid } });
            } else if (tp.taskId) {
              setTasks((prev) => {
                const found = prev.find((t) => t.id === tp.taskId);
                if (found)
                  send({
                    type: "list_tasks",
                    payload: { projectId: found.projectId },
                  });
                return prev;
              });
            }
            break;
          }
          case "task_approved":
          case "task_rejected":
          case "task_deleted":
          case "task_updated": {
            const tp2 = msg.payload as Record<string, unknown>;
            const pid = tp2.projectId as string | undefined;
            if (pid) {
              send({ type: "list_tasks", payload: { projectId: pid } });
            } else if (tp2.taskId) {
              setTasks((prev) => {
                const found = prev.find((t) => t.id === tp2.taskId);
                if (found)
                  send({
                    type: "list_tasks",
                    payload: { projectId: found.projectId },
                  });
                return prev;
              });
            }
            break;
          }
          case "findings":
            setFindings((msg.payload?.findings as FindingData[]) || []);
            break;
          case "finding_posted":
            // Refresh findings
            if (msg.payload?.projectId) {
              send({
                type: "list_findings",
                payload: { projectId: msg.payload.projectId },
              });
            }
            break;
          case "task_diff":
            setTaskDiff(msg.payload as unknown as TaskDiffData);
            break;
          case "provision_progress": {
            const pp = msg.payload as unknown as ProvisionStatus & {
              environmentId: string;
            };
            if (pp.environmentId) {
              setProvisionStatus((prev) => ({
                ...prev,
                [pp.environmentId]: {
                  stage: pp.stage,
                  message: pp.message,
                  progress: pp.progress,
                },
              }));
              // Auto-clear provision status after completion or error
              if (pp.stage === "ready" || pp.stage === "error") {
                const PROVISION_STATUS_CLEAR_DELAY_MS: number = 5_000;
                setTimeout(() => {
                  setProvisionStatus((prev) => {
                    const next = { ...prev };
                    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                    delete next[pp.environmentId];
                    return next;
                  });
                }, PROVISION_STATUS_CLEAR_DELAY_MS);
              }
              send({ type: "list_environments" });
            }
            break;
          }
          case "environment_removed":
            send({ type: "list_environments" });
            send({ type: "list_sessions" });
            break;
          case "error":
            console.error("[ws]", msg.payload?.message);
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = undefined;
        clearInterval(envPollTimer);
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, WS_RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearInterval(envPollTimer);
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [wsUrl, send]);

  const spawn = useCallback(
    (
      environmentId: string,
      prompt: string,
      model?: string,
      runtime?: string,
    ) => {
      send({
        type: "spawn",
        payload: {
          environmentId,
          prompt,
          model: model || "",
          runtime: runtime || "",
        },
      });
    },
    [send],
  );

  const sendInput = useCallback(
    (sessionId: string, text: string) => {
      send({ type: "send_input", payload: { sessionId, text } });
    },
    [send],
  );

  const kill = useCallback(
    (sessionId: string) => {
      send({ type: "kill", payload: { sessionId } });
    },
    [send],
  );

  const refresh = useCallback(() => {
    send({ type: "list_environments" });
    send({ type: "list_sessions" });
    send({ type: "list_projects" });
  }, [send]);

  const loadSessionEvents = useCallback(
    (sessionId: string) => {
      send({ type: "get_session_events", payload: { sessionId } });
    },
    [send],
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // ─── Project methods ──────────────────────────────

  const createProject = useCallback(
    (
      name: string,
      description?: string,
      repoUrl?: string,
      defaultEnvironmentId?: string,
    ) => {
      send({
        type: "create_project",
        payload: {
          name,
          description: description || "",
          repoUrl: repoUrl || "",
          defaultEnvironmentId: defaultEnvironmentId || "",
        },
      });
    },
    [send],
  );

  const archiveProject = useCallback(
    (projectId: string) => {
      send({ type: "archive_project", payload: { projectId } });
    },
    [send],
  );

  const loadTasks = useCallback(
    (projectId: string) => {
      send({ type: "list_tasks", payload: { projectId } });
    },
    [send],
  );

  // ─── Task methods ─────────────────────────────────

  const createTask = useCallback(
    (
      projectId: string,
      title: string,
      description?: string,
      environmentId?: string,
      dependsOn?: string[],
    ) => {
      send({
        type: "create_task",
        payload: {
          projectId,
          title,
          description: description || "",
          environmentId: environmentId || "",
          dependsOn: dependsOn || [],
        },
      });
    },
    [send],
  );

  const startTask = useCallback(
    (taskId: string, runtime?: string, model?: string) => {
      send({
        type: "start_task",
        payload: { taskId, runtime: runtime || "", model: model || "" },
      });
    },
    [send],
  );

  const approveTask = useCallback(
    (taskId: string) => {
      send({ type: "approve_task", payload: { taskId } });
    },
    [send],
  );

  const rejectTask = useCallback(
    (taskId: string, reviewNotes: string) => {
      send({ type: "reject_task", payload: { taskId, reviewNotes } });
    },
    [send],
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      send({ type: "delete_task", payload: { taskId } });
    },
    [send],
  );

  // ─── Findings methods ─────────────────────────────

  const loadFindings = useCallback(
    (projectId: string) => {
      send({ type: "list_findings", payload: { projectId } });
    },
    [send],
  );

  const postFinding = useCallback(
    (
      projectId: string,
      title: string,
      content: string,
      category?: string,
      tags?: string[],
    ) => {
      send({
        type: "post_finding",
        payload: {
          projectId,
          title,
          content,
          category: category || "general",
          tags: tags || [],
        },
      });
    },
    [send],
  );

  // ─── Diff methods ─────────────────────────────────

  const loadTaskDiff = useCallback(
    (taskId: string) => {
      setTaskDiff(undefined);
      send({ type: "get_task_diff", payload: { taskId } });
    },
    [send],
  );

  // ─── Environment lifecycle methods ────────────────

  const provisionEnvironment = useCallback(
    (environmentId: string) => {
      send({ type: "provision_environment", payload: { environmentId } });
    },
    [send],
  );

  const stopEnvironment = useCallback(
    (environmentId: string) => {
      send({ type: "stop_environment", payload: { environmentId } });
    },
    [send],
  );

  const removeEnvironment = useCallback(
    (environmentId: string) => {
      send({ type: "remove_environment", payload: { environmentId } });
    },
    [send],
  );

  return {
    connected,
    environments,
    sessions,
    events,
    lastSpawnedId,
    projects,
    tasks,
    findings,
    taskDiff,
    spawn,
    sendInput,
    kill,
    refresh,
    loadSessionEvents,
    clearEvents,
    createProject,
    archiveProject,
    loadTasks,
    createTask,
    startTask,
    approveTask,
    rejectTask,
    deleteTask,
    loadFindings,
    postFinding,
    loadTaskDiff,
    provisionStatus,
    provisionEnvironment,
    stopEnvironment,
    removeEnvironment,
  };
}
