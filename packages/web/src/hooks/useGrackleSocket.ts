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
  endedAt?: string;
  error?: string;
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
  assignedAt?: string;
  startedAt?: string;
  completedAt?: string;
  parentTaskId: string;
  depth: number;
  childTaskIds: string[];
  canDecompose: boolean;
  personaId: string;
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

export interface TokenInfo {
  name: string;
  tokenType: string;
  envVar: string;
  filePath: string;
  expiresAt: string;
}

/** A GitHub Codespace returned from `gh codespace list`. */
export interface Codespace {
  name: string;
  repository: string;
  state: string;
  gitStatus: string;
}

export interface PersonaData {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  toolConfig: string;
  runtime: string;
  model: string;
  maxTurns: number;
  mcpServers: string;
  createdAt: string;
  updatedAt: string;
}

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
}

// ─── Runtime type guards ──────────────────────────────────────────────────────

/** Returns true when `v` is a non-null, non-array object. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Emit a console warning and return `false` when an incoming payload does not
 * match the expected shape.  We warn rather than throw so a single bad message
 * from the server does not crash the entire UI.
 */
function warnBadPayload(msgType: string, reason: string): false {
  console.warn(`[ws] Malformed "${msgType}" message: ${reason}`);
  return false;
}

function isEnvironment(v: unknown): v is Environment {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.displayName === "string" &&
    typeof v.adapterType === "string" &&
    typeof v.defaultRuntime === "string" &&
    typeof v.status === "string" &&
    typeof v.bootstrapped === "boolean"
  );
}

function isSession(v: unknown): v is Session {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.environmentId === "string" &&
    typeof v.runtime === "string" &&
    typeof v.status === "string" &&
    typeof v.prompt === "string" &&
    typeof v.startedAt === "string" &&
    (v.endedAt === undefined || typeof v.endedAt === "string") &&
    (v.error === undefined || typeof v.error === "string")
  );
}

function isSessionEvent(v: unknown): v is SessionEvent {
  return (
    isObject(v) &&
    typeof v.sessionId === "string" &&
    typeof v.eventType === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.content === "string"
  );
}

function isProject(v: unknown): v is Project {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.repoUrl === "string" &&
    typeof v.defaultEnvironmentId === "string" &&
    typeof v.status === "string" &&
    typeof v.createdAt === "string"
  );
}

function isTaskData(v: unknown): v is TaskData {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.projectId === "string" &&
    typeof v.title === "string" &&
    typeof v.status === "string" &&
    typeof v.branch === "string" &&
    typeof v.sortOrder === "number" &&
    typeof v.depth === "number" &&
    Array.isArray(v.dependsOn) &&
    Array.isArray(v.childTaskIds)
  );
}

function isFindingData(v: unknown): v is FindingData {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.projectId === "string" &&
    typeof v.taskId === "string" &&
    typeof v.sessionId === "string" &&
    typeof v.category === "string" &&
    typeof v.title === "string" &&
    typeof v.content === "string" &&
    Array.isArray(v.tags) &&
    typeof v.createdAt === "string"
  );
}

function isTokenInfo(v: unknown): v is TokenInfo {
  return (
    isObject(v) &&
    typeof v.name === "string" &&
    typeof v.tokenType === "string" &&
    typeof v.envVar === "string" &&
    typeof v.filePath === "string" &&
    typeof v.expiresAt === "string"
  );
}

function isProvisionProgress(
  v: unknown,
): v is ProvisionStatus & { environmentId: string } {
  return (
    isObject(v) &&
    typeof v.environmentId === "string" &&
    typeof v.stage === "string" &&
    typeof v.message === "string" &&
    typeof v.progress === "number"
  );
}

function isCodespace(v: unknown): v is Codespace {
  return (
    isObject(v) &&
    typeof v.name === "string" &&
    typeof v.repository === "string" &&
    typeof v.state === "string" &&
    typeof v.gitStatus === "string"
  );
}

function isPersonaData(v: unknown): v is PersonaData {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    typeof v.systemPrompt === "string" &&
    typeof v.toolConfig === "string" &&
    typeof v.runtime === "string" &&
    typeof v.model === "string" &&
    typeof v.maxTurns === "number" &&
    typeof v.mcpServers === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string"
  );
}

/**
 * Filter an unknown value to a typed array, discarding items that fail the
 * guard and warning about each one.
 */
function asValidArray<T>(
  v: unknown,
  guard: (item: unknown) => item is T,
  msgType: string,
  fieldName: string,
): T[] {
  if (!Array.isArray(v)) {
    warnBadPayload(
      msgType,
      `expected "${fieldName}" to be an array, got ${typeof v}`,
    );
    return [];
  }
  return v.filter((item: unknown, i: number) => {
    if (guard(item)) return true;
    warnBadPayload(
      msgType,
      `item at index ${i} in "${fieldName}" has unexpected shape`,
    );
    return false;
  });
}

/**
 * Parse a raw WebSocket message string into a `WsMessage`.
 * Returns `undefined` and logs a warning if parsing fails or the result is
 * not a valid message object.
 */
function parseWsMessage(data: string): WsMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    console.warn("[ws] Failed to parse WebSocket message as JSON");
    return undefined;
  }
  if (!isObject(parsed) || typeof parsed.type !== "string") {
    console.warn(
      "[ws] Received WebSocket message without a string 'type' field:",
      parsed,
    );
    return undefined;
  }
  return {
    type: parsed.type,
    payload: isObject(parsed.payload) ? parsed.payload : undefined,
  };
}

const WS_RECONNECT_DELAY_MS: number = 3_000;
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
  /**
   * The total number of events that have been silently dropped due to the
   * MAX_EVENTS in-memory cap. A non-zero value means the user is only seeing
   * the most-recent slice of a long session; older events are still available
   * in the server-side JSONL log.
   */
  eventsDropped: number;
  lastSpawnedId: string | undefined;
  projects: Project[];
  tasks: TaskData[];
  findings: FindingData[];
  tokens: TokenInfo[];
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
    parentTaskId?: string,
    personaId?: string,
  ) => void;
  startTask: (
    taskId: string,
    runtime?: string,
    model?: string,
    personaId?: string,
  ) => void;
  approveTask: (taskId: string) => void;
  rejectTask: (taskId: string, reviewNotes: string) => void;
  updateTask: (
    taskId: string,
    title: string,
    description: string,
    dependsOn: string[],
  ) => void;
  deleteTask: (taskId: string) => void;
  loadFindings: (projectId: string) => void;
  postFinding: (
    projectId: string,
    title: string,
    content: string,
    category?: string,
    tags?: string[],
  ) => void;
  addEnvironment: (
    displayName: string,
    adapterType: string,
    adapterConfig?: Record<string, unknown>,
    defaultRuntime?: string,
  ) => void;
  loadTokens: () => void;
  setToken: (
    name: string,
    value: string,
    tokenType: string,
    envVar: string,
    filePath: string,
  ) => void;
  deleteToken: (name: string) => void;
  provisionStatus: Record<string, ProvisionStatus>;
  provisionEnvironment: (environmentId: string) => void;
  stopEnvironment: (environmentId: string) => void;
  removeEnvironment: (environmentId: string) => void;
  codespaces: Codespace[];
  codespaceError: string;
  codespaceCreating: boolean;
  listCodespaces: () => void;
  createCodespace: (repo: string) => void;
  projectCreating: boolean;
  taskStartingId: string | undefined;
  personas: PersonaData[];
  createPersona: (
    name: string,
    description: string,
    systemPrompt: string,
    runtime?: string,
    model?: string,
    maxTurns?: number,
  ) => void;
  updatePersona: (
    personaId: string,
    name?: string,
    description?: string,
    systemPrompt?: string,
    runtime?: string,
    model?: string,
    maxTurns?: number,
  ) => void;
  deletePersona: (personaId: string) => void;
  taskSessions: Record<string, Session[]>;
  loadTaskSessions: (taskId: string) => void;
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
  const [eventsDropped, setEventsDropped] = useState<number>(0);
  const [lastSpawnedId, setLastSpawnedId] = useState<string | undefined>(
    undefined,
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [findings, setFindings] = useState<FindingData[]>([]);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [provisionStatus, setProvisionStatus] = useState<
    Record<string, ProvisionStatus>
  >({});
  const [codespaces, setCodespaces] = useState<Codespace[]>([]);
  const [codespaceError, setCodespaceError] = useState("");
  const [codespaceCreating, setCodespaceCreating] = useState(false);
  const [personas, setPersonas] = useState<PersonaData[]>([]);
  const [taskSessions, setTaskSessions] = useState<Record<string, Session[]>>({});
  const [projectCreating, setProjectCreating] = useState(false);
  const [taskStartingId, setTaskStartingId] = useState<string | undefined>(
    undefined,
  );

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect(): void {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        send({ type: "list_environments" });
        send({ type: "list_sessions" });
        send({ type: "list_projects" });
        send({ type: "list_tokens" });
        send({ type: "list_personas" });
        send({ type: "subscribe_all" });
      };

      ws.onmessage = (e: MessageEvent<unknown>) => {
        if (typeof e.data !== "string") {
          console.warn("[ws] Received non-string WebSocket message; ignoring");
          return;
        }
        const msg = parseWsMessage(e.data);
        if (!msg) return;
        switch (msg.type) {
          case "environments":
            setEnvironments(
              asValidArray(
                msg.payload?.environments,
                isEnvironment,
                "environments",
                "environments",
              ),
            );
            break;
          case "sessions":
            setSessions(
              asValidArray(
                msg.payload?.sessions,
                isSession,
                "sessions",
                "sessions",
              ),
            );
            break;
          case "session_event": {
            if (!isSessionEvent(msg.payload)) {
              warnBadPayload(
                "session_event",
                "payload is not a valid SessionEvent",
              );
              break;
            }
            const event: SessionEvent = msg.payload;
            /* Track drops outside the updater to avoid impure side-effects
               inside React state updaters (StrictMode may invoke updaters
               more than once). The closure variable is assigned (not accumulated),
               so repeated invocations with the same prev yield the same value. */
            let dropped = 0;
            setEvents((prev) => {
              const next = [...prev, event];
              if (next.length > MAX_EVENTS) {
                dropped = next.length - MAX_EVENTS;
                return next.slice(-MAX_EVENTS);
              }
              return next;
            });
            if (dropped > 0) {
              setEventsDropped((n) => n + dropped);
            }
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
            const replayEvents = asValidArray(
              msg.payload?.events,
              isSessionEvent,
              "session_events",
              "events",
            );
            const replaySessionId = msg.payload?.sessionId;
            if (typeof replaySessionId !== "string") {
              warnBadPayload(
                "session_events",
                "missing or non-string sessionId",
              );
              break;
            }
            if (replayEvents.length > 0) {
              let replayDropped = 0;
              setEvents((prev) => {
                const without = prev.filter(
                  (e) => e.sessionId !== replaySessionId,
                );
                const merged = [...without, ...replayEvents];
                if (merged.length > MAX_EVENTS) {
                  replayDropped = merged.length - MAX_EVENTS;
                  return merged.slice(-MAX_EVENTS);
                }
                return merged;
              });
              if (replayDropped > 0) {
                setEventsDropped((n) => n + replayDropped);
              }
            }
            break;
          }
          case "spawned": {
            const spawnedId = msg.payload?.sessionId;
            if (typeof spawnedId === "string" && spawnedId) {
              setLastSpawnedId(spawnedId);
            }
            send({ type: "list_sessions" });
            break;
          }
          case "projects":
            setProjects(
              asValidArray(
                msg.payload?.projects,
                isProject,
                "projects",
                "projects",
              ),
            );
            break;
          case "project_created":
            setProjectCreating(false);
            send({ type: "list_projects" });
            break;
          case "project_archived":
            send({ type: "list_projects" });
            break;
          case "tasks": {
            const incoming = asValidArray(
              msg.payload?.tasks,
              isTaskData,
              "tasks",
              "tasks",
            );
            const pid =
              (typeof msg.payload?.projectId === "string"
                ? msg.payload.projectId
                : "") || (incoming.length > 0 ? incoming[0].projectId : "");
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
            const taskData = msg.payload?.task;
            if (isObject(taskData)) {
              const pid =
                typeof taskData.project_id === "string"
                  ? taskData.project_id
                  : typeof taskData.projectId === "string"
                    ? taskData.projectId
                    : "";
              if (pid)
                send({ type: "list_tasks", payload: { projectId: pid } });
            }
            break;
          }
          case "task_started": {
            const tp = msg.payload;
            if (!isObject(tp)) break;
            setTaskStartingId((prev) =>
              tp.taskId && prev === tp.taskId ? undefined : prev,
            );
            if (tp.sessionId) {
              send({ type: "list_sessions" });
            }
            // Refresh tasks for the project
            const startedPid =
              typeof tp.projectId === "string" ? tp.projectId : undefined;
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
            const tp2 = msg.payload;
            if (!isObject(tp2)) break;
            const pid =
              typeof tp2.projectId === "string" ? tp2.projectId : undefined;
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
            setFindings(
              asValidArray(
                msg.payload?.findings,
                isFindingData,
                "findings",
                "findings",
              ),
            );
            break;
          case "finding_posted":
            // Refresh findings
            if (typeof msg.payload?.projectId === "string") {
              send({
                type: "list_findings",
                payload: { projectId: msg.payload.projectId },
              });
            }
            break;
          case "tokens":
            setTokens(
              asValidArray(
                msg.payload?.tokens,
                isTokenInfo,
                "tokens",
                "tokens",
              ),
            );
            break;
          case "token_changed":
            send({ type: "list_tokens" });
            break;
          case "provision_progress": {
            if (!isProvisionProgress(msg.payload)) {
              warnBadPayload(
                "provision_progress",
                "payload is not a valid ProvisionStatus with environmentId",
              );
              break;
            }
            const pp = msg.payload;
            setProvisionStatus((prev) => ({
              ...prev,
              [pp.environmentId]: {
                stage: pp.stage,
                message: pp.message,
                progress: pp.progress,
              },
            }));
            // Auto-clear provision status after successful completion only;
            // errors persist until the user retries or removes the environment
            if (pp.stage === "ready") {
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
            // Server broadcasts the environment list via broadcastEnvironments() on terminal stages
            break;
          }
          case "environment_added":
            // Server already broadcasts updated environment list via broadcastEnvironments()
            break;
          case "environment_removed":
            // Clean up stale provision status and optimistically remove the
            // environment from local state so the UI updates immediately even
            // when the removal was triggered via gRPC/CLI (which does not call
            // broadcastEnvironments).
            if (typeof msg.payload?.environmentId === "string") {
              const removedId = msg.payload.environmentId;
              setEnvironments((prev) => prev.filter((e) => e.id !== removedId));
              setProvisionStatus((prev) => {
                const next = { ...prev };
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete next[removedId];
                return next;
              });
            }
            // Fetch sessions since the server deletes them but doesn't broadcast sessions
            send({ type: "list_sessions" });
            break;
          case "codespaces_list": {
            const list = asValidArray(
              msg.payload?.codespaces,
              isCodespace,
              "codespaces_list",
              "codespaces",
            );
            const listError =
              typeof msg.payload?.error === "string" ? msg.payload.error : "";
            setCodespaces(list);
            setCodespaceError(listError);
            break;
          }
          case "codespace_created": {
            setCodespaceCreating(false);
            // Refresh list to include the newly created codespace
            send({ type: "list_codespaces" });
            break;
          }
          case "codespace_create_error": {
            setCodespaceCreating(false);
            const createError =
              typeof msg.payload?.message === "string"
                ? msg.payload.message
                : "Failed to create codespace";
            setCodespaceError(createError);
            break;
          }
          case "personas": {
            const list = asValidArray(
              msg.payload?.personas,
              isPersonaData,
              "personas",
              "personas",
            );
            setPersonas(list);
            break;
          }
          case "persona_created":
          case "persona_updated":
          case "persona_deleted":
            send({ type: "list_personas" });
            break;
          case "task_sessions": {
            const taskId = msg.payload?.taskId;
            if (typeof taskId !== "string" || !taskId) break;
            const sessionsArr = asValidArray(msg.payload?.sessions, isSession, "task_sessions", "sessions");
            setTaskSessions((prev) => ({ ...prev, [taskId]: sessionsArr }));
            break;
          }
          case "error":
            console.error("[ws]", msg.payload?.message);
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = undefined;
        setProjectCreating(false);
        setTaskStartingId(undefined);
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, WS_RECONNECT_DELAY_MS);
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
    send({ type: "list_tokens" });
  }, [send]);

  const loadSessionEvents = useCallback(
    (sessionId: string) => {
      send({ type: "get_session_events", payload: { sessionId } });
    },
    [send],
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
    setEventsDropped(0);
  }, []);

  // ─── Project methods ──────────────────────────────

  const createProject = useCallback(
    (
      name: string,
      description?: string,
      repoUrl?: string,
      defaultEnvironmentId?: string,
    ) => {
      setProjectCreating(true);
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
      parentTaskId?: string,
      personaId?: string,
    ) => {
      send({
        type: "create_task",
        payload: {
          projectId,
          title,
          description: description || "",
          environmentId: environmentId || "",
          dependsOn: dependsOn || [],
          parentTaskId: parentTaskId || "",
          personaId: personaId || "",
        },
      });
    },
    [send],
  );

  const startTask = useCallback(
    (taskId: string, runtime?: string, model?: string, personaId?: string) => {
      setTaskStartingId(taskId);
      send({
        type: "start_task",
        payload: {
          taskId,
          runtime: runtime || "",
          model: model || "",
          personaId: personaId || "",
        },
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

  const updateTask = useCallback(
    (taskId: string, title: string, description: string, dependsOn: string[]) => {
      send({
        type: "update_task",
        payload: { taskId, title, description, dependsOn },
      });
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

  // ─── Token methods ──────────────────────────────────

  const loadTokens = useCallback(() => {
    send({ type: "list_tokens" });
  }, [send]);

  const setToken = useCallback(
    (
      name: string,
      value: string,
      tokenType: string,
      envVar: string,
      filePath: string,
    ) => {
      send({
        type: "set_token",
        payload: { name, value, tokenType, envVar, filePath },
      });
    },
    [send],
  );

  const deleteToken = useCallback(
    (name: string) => {
      send({ type: "delete_token", payload: { name } });
    },
    [send],
  );

  // ─── Environment lifecycle methods ────────────────

  const addEnvironment = useCallback(
    (
      displayName: string,
      adapterType: string,
      adapterConfig?: Record<string, unknown>,
      defaultRuntime?: string,
    ) => {
      const payload: Record<string, unknown> = {
        displayName,
        adapterType,
        adapterConfig: adapterConfig || {},
      };
      if (defaultRuntime) {
        payload.defaultRuntime = defaultRuntime;
      }
      send({ type: "add_environment", payload });
    },
    [send],
  );

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

  // ─── Codespace methods ─────────────────────────────

  const listCodespaces = useCallback(() => {
    send({ type: "list_codespaces" });
  }, [send]);

  const createCodespace = useCallback(
    (repo: string) => {
      if (!connected) {
        setCodespaceError(
          "Not connected to server. Please try again once the connection is restored.",
        );
        return;
      }
      setCodespaceCreating(true);
      setCodespaceError("");
      send({ type: "create_codespace", payload: { repo } });
    },
    [send, connected],
  );

  // ─── Persona methods ──────────────────────────────

  const createPersona = useCallback(
    (
      name: string,
      description: string,
      systemPrompt: string,
      runtime?: string,
      model?: string,
      maxTurns?: number,
    ) => {
      send({
        type: "create_persona",
        payload: {
          name,
          description,
          systemPrompt,
          runtime: runtime || "",
          model: model || "",
          maxTurns: maxTurns || 0,
        },
      });
    },
    [send],
  );

  const updatePersona = useCallback(
    (
      personaId: string,
      name?: string,
      description?: string,
      systemPrompt?: string,
      runtime?: string,
      model?: string,
      maxTurns?: number,
    ) => {
      send({
        type: "update_persona",
        payload: {
          personaId,
          name: name || "",
          description: description || "",
          systemPrompt: systemPrompt || "",
          runtime: runtime || "",
          model: model || "",
          maxTurns: maxTurns || 0,
        },
      });
    },
    [send],
  );

  const deletePersona = useCallback(
    (personaId: string) => {
      send({ type: "delete_persona", payload: { personaId } });
    },
    [send],
  );

  const loadTaskSessions = useCallback(
    (taskId: string) => {
      send({ type: "get_task_sessions", payload: { taskId } });
    },
    [send],
  );

  return {
    connected,
    environments,
    sessions,
    events,
    eventsDropped,
    lastSpawnedId,
    projects,
    tasks,
    findings,
    tokens,
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
    updateTask,
    deleteTask,
    loadFindings,
    postFinding,
    addEnvironment,
    loadTokens,
    setToken,
    deleteToken,
    provisionStatus,
    provisionEnvironment,
    stopEnvironment,
    removeEnvironment,
    codespaces,
    codespaceError,
    codespaceCreating,
    listCodespaces,
    createCodespace,
    projectCreating,
    taskStartingId,
    personas,
    createPersona,
    updatePersona,
    deletePersona,
    taskSessions,
    loadTaskSessions,
  };
}
