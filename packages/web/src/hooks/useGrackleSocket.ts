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
  envId: string;
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
  defaultEnvId: string;
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
  envId: string;
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

declare global {
  interface Window {
    __GRACKLE_API_KEY__?: string;
  }
}

export function useGrackleSocket(url?: string) {
  const apiKey = typeof window !== "undefined" ? window.__GRACKLE_API_KEY__ || "" : "";
  const wsUrl = url || (typeof window !== "undefined"
    ? `ws://${window.location.hostname}:3000?token=${encodeURIComponent(apiKey)}`
    : "ws://localhost:3000");

  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [lastSpawnedId, setLastSpawnedId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [findings, setFindings] = useState<FindingData[]>([]);
  const [taskDiff, setTaskDiff] = useState<TaskDiffData | null>(null);

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        send({ type: "list_environments" });
        send({ type: "list_sessions" });
        send({ type: "list_projects" });
        send({ type: "subscribe_all" });
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
            setEvents((prev) => [...prev, event]);
            if (event.eventType === "status") {
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === event.sessionId ? { ...s, status: event.content } : s
                )
              );
            }
            break;
          }
          case "session_events": {
            const replayEvents = msg.payload?.events as SessionEvent[] | undefined;
            const replaySessionId = msg.payload?.sessionId as string;
            if (replayEvents && replaySessionId) {
              setEvents((prev) => {
                const without = prev.filter((e) => e.sessionId !== replaySessionId);
                return [...without, ...replayEvents];
              });
            }
            break;
          }
          case "spawned": {
            const spawnedId = msg.payload?.sessionId as string;
            if (spawnedId) setLastSpawnedId(spawnedId);
            send({ type: "list_sessions" });
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
          case "tasks":
            setTasks((msg.payload?.tasks as TaskData[]) || []);
            break;
          case "task_created":
          case "task_started":
          case "task_approved":
          case "task_rejected":
          case "task_deleted": {
            // Refresh tasks for the relevant project
            const taskPayload = msg.payload as Record<string, unknown>;
            // Refresh the task list — we need to know which project
            // Try to find the project from current tasks state
            if (taskPayload.taskId) {
              const existing = tasks.find((t) => t.id === taskPayload.taskId);
              if (existing) {
                send({ type: "list_tasks", payload: { projectId: existing.projectId } });
              }
            }
            // Also handle task_started which includes sessionId
            if (msg.type === "task_started" && taskPayload.sessionId) {
              setLastSpawnedId(taskPayload.sessionId as string);
              send({ type: "list_sessions" });
            }
            break;
          }
          case "findings":
            setFindings((msg.payload?.findings as FindingData[]) || []);
            break;
          case "finding_posted":
            // Refresh findings
            if (msg.payload?.projectId) {
              send({ type: "list_findings", payload: { projectId: msg.payload.projectId } });
            }
            break;
          case "task_diff":
            setTaskDiff(msg.payload as unknown as TaskDiffData);
            break;
          case "error":
            console.error("[ws]", msg.payload?.message);
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [wsUrl, send]);

  const spawn = useCallback(
    (envId: string, prompt: string, model?: string, runtime?: string) => {
      send({
        type: "spawn",
        payload: { envId, prompt, model: model || "", runtime: runtime || "" },
      });
    },
    [send]
  );

  const sendInput = useCallback(
    (sessionId: string, text: string) => {
      send({ type: "send_input", payload: { sessionId, text } });
    },
    [send]
  );

  const kill = useCallback(
    (sessionId: string) => {
      send({ type: "kill", payload: { sessionId } });
    },
    [send]
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
    [send]
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // ─── Project methods ──────────────────────────────

  const createProject = useCallback(
    (name: string, description?: string, repoUrl?: string, defaultEnvId?: string) => {
      send({
        type: "create_project",
        payload: { name, description: description || "", repoUrl: repoUrl || "", defaultEnvId: defaultEnvId || "" },
      });
    },
    [send]
  );

  const archiveProject = useCallback(
    (projectId: string) => {
      send({ type: "archive_project", payload: { projectId } });
    },
    [send]
  );

  const loadTasks = useCallback(
    (projectId: string) => {
      send({ type: "list_tasks", payload: { projectId } });
    },
    [send]
  );

  // ─── Task methods ─────────────────────────────────

  const createTask = useCallback(
    (projectId: string, title: string, description?: string, envId?: string, dependsOn?: string[]) => {
      send({
        type: "create_task",
        payload: {
          projectId,
          title,
          description: description || "",
          envId: envId || "",
          dependsOn: dependsOn || [],
        },
      });
    },
    [send]
  );

  const startTask = useCallback(
    (taskId: string, runtime?: string, model?: string) => {
      send({
        type: "start_task",
        payload: { taskId, runtime: runtime || "", model: model || "" },
      });
    },
    [send]
  );

  const approveTask = useCallback(
    (taskId: string) => {
      send({ type: "approve_task", payload: { taskId } });
    },
    [send]
  );

  const rejectTask = useCallback(
    (taskId: string, reviewNotes: string) => {
      send({ type: "reject_task", payload: { taskId, reviewNotes } });
    },
    [send]
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      send({ type: "delete_task", payload: { taskId } });
    },
    [send]
  );

  // ─── Findings methods ─────────────────────────────

  const loadFindings = useCallback(
    (projectId: string) => {
      send({ type: "list_findings", payload: { projectId } });
    },
    [send]
  );

  const postFinding = useCallback(
    (projectId: string, title: string, content: string, category?: string, tags?: string[]) => {
      send({
        type: "post_finding",
        payload: { projectId, title, content, category: category || "general", tags: tags || [] },
      });
    },
    [send]
  );

  // ─── Diff methods ─────────────────────────────────

  const loadTaskDiff = useCallback(
    (taskId: string) => {
      setTaskDiff(null);
      send({ type: "get_task_diff", payload: { taskId } });
    },
    [send]
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
  };
}
