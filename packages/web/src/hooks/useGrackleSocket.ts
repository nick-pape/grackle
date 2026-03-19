/**
 * Composition hook that wires together all domain hooks over a single WebSocket
 * connection.  This is the only hook that components consume (via
 * {@link GrackleContext}).
 *
 * @module
 */

import { useCallback, useState } from "react";
import type { WsMessage, SendFunction, GrackleEvent } from "./types.js";
import { useWebSocket } from "./useWebSocket.js";
import { useEnvironments } from "./useEnvironments.js";
import { useSessions } from "./useSessions.js";
import { useProjects } from "./useProjects.js";
import { useTasks } from "./useTasks.js";
import { useFindings } from "./useFindings.js";
import { useTokens } from "./useTokens.js";
import { useCredentials } from "./useCredentials.js";
import { useCodespaces } from "./useCodespaces.js";
import { usePersonas } from "./usePersonas.js";

// ─── Re-exports ───────────────────────────────────────────────────────────────
// Keep consumer imports (e.g. `from "../hooks/useGrackleSocket.js"`) working.

export type {
  Environment,
  Session,
  SessionEvent,
  Project,
  TaskData,
  FindingData,
  TokenInfo,
  CredentialProviderConfig,
  Codespace,
  PersonaData,
  ProvisionStatus,
  WsMessage,
  SendFunction,
  GrackleEvent,
} from "./types.js";

// ─── Result interface ─────────────────────────────────────────────────────────

/** Return type for the {@link useGrackleSocket} hook. */
export interface UseGrackleSocketResult {
  connected: boolean;
  environments: import("./types.js").Environment[];
  sessions: import("./types.js").Session[];
  events: import("./types.js").SessionEvent[];
  /**
   * The total number of events that have been silently dropped due to the
   * MAX_EVENTS in-memory cap. A non-zero value means the user is only seeing
   * the most-recent slice of a long session; older events are still available
   * in the server-side JSONL log.
   */
  eventsDropped: number;
  lastSpawnedId: string | undefined;
  projects: import("./types.js").Project[];
  tasks: import("./types.js").TaskData[];
  findings: import("./types.js").FindingData[];
  tokens: import("./types.js").TokenInfo[];
  spawn: (
    environmentId: string,
    prompt: string,
    personaId?: string,
    worktreeBasePath?: string,
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
    defaultPersonaId?: string,
  ) => void;
  archiveProject: (projectId: string) => void;
  updateProject: (
    projectId: string,
    fields: {
      name?: string;
      description?: string;
      repoUrl?: string;
      defaultEnvironmentId?: string;
      worktreeBasePath?: string;
      useWorktrees?: boolean;
      defaultPersonaId?: string;
    },
  ) => void;
  loadTasks: (projectId: string) => void;
  createTask: (
    projectId: string,
    title: string,
    description?: string,
    dependsOn?: string[],
    parentTaskId?: string,
    defaultPersonaId?: string,
    canDecompose?: boolean,
    onSuccess?: () => void,
    onError?: (message: string) => void,
  ) => void;
  startTask: (
    taskId: string,
    personaId?: string,
    environmentId?: string,
    notes?: string,
  ) => void;
  stopTask: (taskId: string, sessionId: string) => void;
  completeTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
  updateTask: (
    taskId: string,
    title: string,
    description: string,
    dependsOn: string[],
    defaultPersonaId?: string,
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
  credentialProviders: import("./types.js").CredentialProviderConfig;
  updateCredentialProviders: (config: import("./types.js").CredentialProviderConfig) => void;
  provisionStatus: Record<string, import("./types.js").ProvisionStatus>;
  provisionEnvironment: (environmentId: string) => void;
  stopEnvironment: (environmentId: string) => void;
  removeEnvironment: (environmentId: string) => void;
  codespaces: import("./types.js").Codespace[];
  codespaceError: string;
  codespaceListError: string;
  codespaceCreating: boolean;
  listCodespaces: () => void;
  createCodespace: (repo: string, machine?: string) => void;
  projectCreating: boolean;
  taskStartingId: string | undefined;
  personas: import("./types.js").PersonaData[];
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
  taskSessions: Record<string, import("./types.js").Session[]>;
  loadTaskSessions: (taskId: string) => void;
  /** The app-level default persona ID (from server settings). */
  appDefaultPersonaId: string;
  /** Set the app-level default persona ID (persisted via server settings). */
  setAppDefaultPersonaId: (personaId: string) => void;
  /** Whether the first-run onboarding wizard has been completed. */
  onboardingCompleted: boolean;
  /** Mark onboarding as complete (persisted via server settings). */
  completeOnboarding: () => void;
}

// ─── Composition hook ─────────────────────────────────────────────────────────

/**
 * Top-level hook that composes all domain hooks over a single WebSocket.
 *
 * Hook call order is fixed (React requirement). `useWebSocket` is called first
 * to obtain a stable `send` reference. It stores `onMessage`/`onConnect`/
 * `onDisconnect` in refs, so they can safely reference domain hooks defined
 * after `useWebSocket` in the call order — the refs pick up the latest
 * callbacks each render.
 *
 * @param url - Optional WebSocket URL override.
 * @returns The full Grackle client state and actions.
 */
export function useGrackleSocket(url?: string): UseGrackleSocketResult {
  // --- Settings state ---

  const [appDefaultPersonaId, setAppDefaultPersonaIdState] = useState("");
  const [onboardingCompleted, setOnboardingCompleted] = useState(true);

  // --- Transport (must be first to provide `send`) ---

  const { connected, send } = useWebSocket(url, {
    onMessage,
    onConnect,
    onDisconnect,
  });

  // --- Domain hooks (all receive stable `send`) ---

  const environmentsHook = useEnvironments(send);
  const sessionsHook = useSessions(send);
  const projectsHook = useProjects(send);
  const tasksHook = useTasks(send);
  const findingsHook = useFindings(send);
  const tokensHook = useTokens(send);
  const credentialsHook = useCredentials(send);
  const codespacesHook = useCodespaces(send, connected);
  const personasHook = usePersonas(send);

  // --- Settings helpers ---

  /** Key used for the app-level default persona setting. */
  const SETTING_KEY_DEFAULT_PERSONA = "default_persona_id";

  /** Key used for the onboarding completed setting. */
  const SETTING_KEY_ONBOARDING_COMPLETED = "onboarding_completed";

  const setAppDefaultPersonaId = useCallback(
    (personaId: string) => {
      setAppDefaultPersonaIdState(personaId);
      send({
        type: "set_setting",
        payload: { key: SETTING_KEY_DEFAULT_PERSONA, value: personaId },
      });
    },
    [send],
  );

  const completeOnboarding = useCallback(() => {
    setOnboardingCompleted(true);
    send({
      type: "set_setting",
      payload: { key: SETTING_KEY_ONBOARDING_COMPLETED, value: "true" },
    });
  }, [send]);

  // --- Message routing ---

  /** Route a domain event (dot-notation type) to the appropriate hook. */
  function routeDomainEvent(event: GrackleEvent): void {
    const key = event.payload.key as string | undefined;
    const value = event.payload.value as string | undefined;

    // Settings events
    if (event.type === "setting.changed") {
      if (key === SETTING_KEY_DEFAULT_PERSONA) {
        setAppDefaultPersonaIdState(value ?? "");
      }
      if (key === SETTING_KEY_ONBOARDING_COMPLETED) {
        setOnboardingCompleted(value === "true");
      }
      return;
    }

    if (environmentsHook.handleEvent(event)) { return; }
    if (projectsHook.handleEvent(event)) { return; }
    if (tasksHook.handleEvent(event)) { return; }
    if (findingsHook.handleEvent(event)) { return; }
    if (tokensHook.handleEvent(event)) { return; }
    if (credentialsHook.handleEvent(event)) { return; }
    if (personasHook.handleEvent(event)) { return; }
  }

  function onMessage(msg: WsMessage): void {
    // Domain events from event bus (dot-notation types)
    if (typeof msg.type === "string" && msg.type.includes(".")) {
      const raw = msg as WsMessage & { id?: string; timestamp?: string };
      const event: GrackleEvent = {
        id: raw.id ?? "",
        type: msg.type,
        timestamp: raw.timestamp ?? "",
        payload: msg.payload ?? {},
      };
      routeDomainEvent(event);
      return;
    }

    // Handle settings response (request/response, not event bus)
    if (msg.type === "setting") {
      const key = msg.payload?.key as string | undefined;
      const value = msg.payload?.value as string | undefined;
      if (key === SETTING_KEY_DEFAULT_PERSONA) {
        setAppDefaultPersonaIdState(value ?? "");
      }
      if (key === SETTING_KEY_ONBOARDING_COMPLETED) {
        setOnboardingCompleted(value === "true");
      }
      return;
    }

    // Request/response messages (existing routing)
    if (environmentsHook.handleMessage(msg)) { return; }
    if (sessionsHook.handleMessage(msg)) { return; }
    if (projectsHook.handleMessage(msg)) { return; }
    if (tasksHook.handleMessage(msg)) { return; }
    if (findingsHook.handleMessage(msg)) { return; }
    if (tokensHook.handleMessage(msg)) { return; }
    if (credentialsHook.handleMessage(msg)) { return; }
    if (codespacesHook.handleMessage(msg)) { return; }
    if (personasHook.handleMessage(msg)) { return; }
    if (msg.type === "error") {
      console.error("[ws]", msg.payload?.message);
      return;
    }
  }

  function onConnect(sendFn: SendFunction): void {
    sendFn({ type: "list_environments" });
    sendFn({ type: "list_sessions" });
    sendFn({ type: "list_projects" });
    sendFn({ type: "list_tokens" });
    sendFn({ type: "get_credential_providers" });
    sendFn({ type: "list_personas" });
    sendFn({ type: "get_setting", payload: { key: SETTING_KEY_DEFAULT_PERSONA } });
    sendFn({ type: "get_setting", payload: { key: SETTING_KEY_ONBOARDING_COMPLETED } });
    sendFn({ type: "subscribe_all" });
  }

  function onDisconnect(): void {
    projectsHook.onDisconnect();
    tasksHook.onDisconnect();
  }

  const refresh = useCallback(() => {
    send({ type: "list_environments" });
    send({ type: "list_sessions" });
    send({ type: "list_projects" });
    send({ type: "list_tokens" });
  }, [send]);

  return {
    connected,
    environments: environmentsHook.environments,
    sessions: sessionsHook.sessions,
    events: sessionsHook.events,
    eventsDropped: sessionsHook.eventsDropped,
    lastSpawnedId: sessionsHook.lastSpawnedId,
    projects: projectsHook.projects,
    tasks: tasksHook.tasks,
    findings: findingsHook.findings,
    tokens: tokensHook.tokens,
    spawn: sessionsHook.spawn,
    sendInput: sessionsHook.sendInput,
    kill: sessionsHook.kill,
    refresh,
    loadSessionEvents: sessionsHook.loadSessionEvents,
    clearEvents: sessionsHook.clearEvents,
    createProject: projectsHook.createProject,
    archiveProject: projectsHook.archiveProject,
    updateProject: projectsHook.updateProject,
    loadTasks: tasksHook.loadTasks,
    createTask: tasksHook.createTask,
    startTask: tasksHook.startTask,
    stopTask: tasksHook.stopTask,
    completeTask: tasksHook.completeTask,
    resumeTask: tasksHook.resumeTask,
    updateTask: tasksHook.updateTask,
    deleteTask: tasksHook.deleteTask,
    loadFindings: findingsHook.loadFindings,
    postFinding: findingsHook.postFinding,
    addEnvironment: environmentsHook.addEnvironment,
    loadTokens: tokensHook.loadTokens,
    setToken: tokensHook.setToken,
    deleteToken: tokensHook.deleteToken,
    credentialProviders: credentialsHook.credentialProviders,
    updateCredentialProviders: credentialsHook.updateCredentialProviders,
    provisionStatus: environmentsHook.provisionStatus,
    provisionEnvironment: environmentsHook.provisionEnvironment,
    stopEnvironment: environmentsHook.stopEnvironment,
    removeEnvironment: environmentsHook.removeEnvironment,
    codespaces: codespacesHook.codespaces,
    codespaceError: codespacesHook.codespaceError,
    codespaceListError: codespacesHook.codespaceListError,
    codespaceCreating: codespacesHook.codespaceCreating,
    listCodespaces: codespacesHook.listCodespaces,
    createCodespace: codespacesHook.createCodespace,
    projectCreating: projectsHook.projectCreating,
    taskStartingId: tasksHook.taskStartingId,
    personas: personasHook.personas,
    createPersona: personasHook.createPersona,
    updatePersona: personasHook.updatePersona,
    deletePersona: personasHook.deletePersona,
    taskSessions: sessionsHook.taskSessions,
    loadTaskSessions: sessionsHook.loadTaskSessions,
    appDefaultPersonaId,
    setAppDefaultPersonaId,
    onboardingCompleted,
    completeOnboarding,
  };
}
