/**
 * Composition hook that wires together all domain hooks over a single WebSocket
 * connection.  This is the only hook that components consume (via
 * {@link GrackleContext}).
 *
 * @module
 */

import { useCallback, useState } from "react";
import type { WsMessage, SendFunction, GrackleEvent, UsageStats } from "./types.js";
import { isGrackleEvent } from "./types.js";
import { useWebSocket } from "./useWebSocket.js";
import { useEnvironments } from "./useEnvironments.js";
import { useSessions } from "./useSessions.js";
import { useWorkspaces } from "./useWorkspaces.js";
import { useTasks } from "./useTasks.js";
import { useFindings } from "./useFindings.js";
import { useTokens } from "./useTokens.js";
import { useCredentials } from "./useCredentials.js";
import { useCodespaces } from "./useCodespaces.js";
import { usePersonas } from "./usePersonas.js";
import { useKnowledge } from "./useKnowledge.js";
import { grackleClient } from "./useGrackleClient.js";
import { protoToUsageStats } from "./proto-converters.js";

// ─── Re-exports ───────────────────────────────────────────────────────────────
// Keep consumer imports (e.g. `from "../hooks/useGrackleSocket.js"`) working.

export type {
  Environment,
  Session,
  SessionEvent,
  Workspace,
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

export { isGrackleEvent } from "./types.js";

// ─── Result interface ─────────────────────────────────────────────────────────

/** Return type for the {@link useGrackleSocket} hook. */
export interface UseGrackleSocketResult {
  connected: boolean;
  /** Raw send function for WebSocket messages. */
  send: import("./types.js").SendFunction;
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
  workspaces: import("./types.js").Workspace[];
  tasks: import("./types.js").TaskData[];
  findings: import("./types.js").FindingData[];
  tokens: import("./types.js").TokenInfo[];
  spawn: (
    environmentId: string,
    prompt: string,
    personaId?: string,
    workingDirectory?: string,
  ) => void;
  sendInput: (sessionId: string, text: string) => void;
  kill: (sessionId: string) => void;
  refresh: () => void;
  loadSessionEvents: (sessionId: string) => void;
  clearEvents: () => void;
  /** Request the current workspace list from the server. */
  loadWorkspaces: () => void;
  createWorkspace: (
    name: string,
    description?: string,
    repoUrl?: string,
    environmentId?: string,
    defaultPersonaId?: string,
    useWorktrees?: boolean,
    workingDirectory?: string,
    onSuccess?: () => void,
    onError?: (message: string) => void,
  ) => void;
  archiveWorkspace: (workspaceId: string) => void;
  updateWorkspace: (
    workspaceId: string,
    fields: {
      name?: string;
      description?: string;
      repoUrl?: string;
      environmentId?: string;
      workingDirectory?: string;
      useWorktrees?: boolean;
      defaultPersonaId?: string;
    },
  ) => void;
  loadTasks: (workspaceId: string) => void;
  loadAllTasks: () => void;
  createTask: (
    workspaceId: string,
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
  stopTask: (taskId: string) => void;
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
  loadFindings: (workspaceId: string) => void;
  postFinding: (
    workspaceId: string,
    title: string,
    content: string,
    category?: string,
    tags?: string[],
  ) => void;
  /** Request the current environment list from the server. */
  loadEnvironments: () => void;
  addEnvironment: (
    displayName: string,
    adapterType: string,
    adapterConfig?: Record<string, unknown>,
  ) => void;
  updateEnvironment: (
    environmentId: string,
    fields: { displayName?: string; adapterConfig?: Record<string, unknown> },
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
  provisionEnvironment: (environmentId: string, force?: boolean) => void;
  stopEnvironment: (environmentId: string) => void;
  removeEnvironment: (environmentId: string) => void;
  codespaces: import("./types.js").Codespace[];
  codespaceError: string;
  codespaceListError: string;
  codespaceCreating: boolean;
  listCodespaces: () => void;
  createCodespace: (repo: string, machine?: string) => void;
  workspaceCreating: boolean;
  taskStartingId: string | undefined;
  personas: import("./types.js").PersonaData[];
  createPersona: (
    name: string,
    description: string,
    systemPrompt: string,
    runtime?: string,
    model?: string,
    maxTurns?: number,
    type?: string,
    script?: string,
  ) => void;
  updatePersona: (
    personaId: string,
    name?: string,
    description?: string,
    systemPrompt?: string,
    runtime?: string,
    model?: string,
    maxTurns?: number,
    type?: string,
    script?: string,
  ) => void;
  deletePersona: (personaId: string) => void;
  taskSessions: Record<string, import("./types.js").Session[]>;
  loadTaskSessions: (taskId: string) => void;
  /** The app-level default persona ID (from server settings). */
  appDefaultPersonaId: string;
  /** Set the app-level default persona ID (persisted via server settings). */
  setAppDefaultPersonaId: (personaId: string) => void;
  /** Whether the first-run onboarding wizard has been completed. `undefined` until the server responds. */
  onboardingCompleted: boolean | undefined;
  /** Mark onboarding as complete (persisted via server settings). */
  completeOnboarding: () => void;
  /** Cached usage stats keyed by "scope:id" (e.g. "workspace:abc123"). */
  usageCache: Record<string, import("./types.js").UsageStats>;
  /** Request aggregated usage stats from the server for a given scope and entity ID. */
  loadUsage: (scope: string, id: string) => void;
  /** Knowledge graph hook. */
  knowledge: import("./useKnowledge.js").UseKnowledgeResult;
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
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | undefined>(undefined);
  const [usageCache, setUsageCache] = useState<Record<string, UsageStats>>({});

  // --- Transport (must be first to provide `send`) ---

  const { connected, send } = useWebSocket(url, {
    onMessage,
    onConnect,
    onDisconnect,
  });

  // --- Domain hooks (all receive stable `send`) ---

  const environmentsHook = useEnvironments();
  const sessionsHook = useSessions();
  const workspacesHook = useWorkspaces();
  const tasksHook = useTasks();
  const findingsHook = useFindings();
  const tokensHook = useTokens();
  const credentialsHook = useCredentials();
  const codespacesHook = useCodespaces();
  const personasHook = usePersonas();
  const knowledgeHook = useKnowledge(send);

  // --- Settings helpers ---

  /** Key used for the app-level default persona setting. */
  const SETTING_KEY_DEFAULT_PERSONA = "default_persona_id";

  /** Key used for the onboarding completed setting. */
  const SETTING_KEY_ONBOARDING_COMPLETED = "onboarding_completed";

  const setAppDefaultPersonaId = useCallback(
    (personaId: string) => {
      setAppDefaultPersonaIdState(personaId);
      grackleClient.setSetting({ key: SETTING_KEY_DEFAULT_PERSONA, value: personaId }).catch(
        () => {},
      );
    },
    [],
  );

  const completeOnboarding = useCallback(() => {
    setOnboardingCompleted(true);
    grackleClient.setSetting({ key: SETTING_KEY_ONBOARDING_COMPLETED, value: "true" }).catch(
      () => {},
    );
  }, []);

  const loadUsage = useCallback(
    (scope: string, id: string) => {
      grackleClient.getUsage({ scope, id }).then(
        (resp) => {
          const key = `${scope}:${id}`;
          setUsageCache((prev) => ({
            ...prev,
            [key]: protoToUsageStats(resp),
          }));
        },
        () => {},
      );
    },
    [],
  );

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

    if (environmentsHook.handleEvent(event)) {
      if (event.type === "environment.removed" || event.type === "environment.changed") {
        sessionsHook.loadSessions();
      }
      return;
    }
    if (workspacesHook.handleEvent(event)) { return; }
    if (tasksHook.handleEvent(event)) {
      // task.started also needs a session refresh (cross-concern)
      if (event.type === "task.started") {
        sessionsHook.loadSessions();
      }
      return;
    }
    if (findingsHook.handleEvent(event)) { return; }
    if (tokensHook.handleEvent(event)) { return; }
    if (credentialsHook.handleEvent(event)) { return; }
    if (personasHook.handleEvent(event)) { return; }
  }

  function onMessage(msg: WsMessage | GrackleEvent): void {
    // Domain events from event bus — already validated by parseWsMessage
    if (isGrackleEvent(msg)) {
      routeDomainEvent(msg);
      return;
    }

    // Real-time session events from subscribe_all
    if (sessionsHook.handleMessage(msg)) { return; }
    if (knowledgeHook.handleMessage(msg)) { return; }

    // Legacy WS message handlers — these only fire when E2E tests inject
    // fake data via injectWsMessage(). Normal operation uses ConnectRPC.
    if (sessionsHook.handleLegacyMessage?.(msg)) { return; }
    if (environmentsHook.handleLegacyMessage?.(msg)) { return; }
    if (tasksHook.handleLegacyMessage?.(msg)) { return; }

    if (msg.type === "error") {
      console.error("[ws]", msg.payload?.message);
      return;
    }
  }

  function onConnect(sendFn: SendFunction): void {
    environmentsHook.loadEnvironments();
    sessionsHook.loadSessions();
    workspacesHook.loadWorkspaces();
    tokensHook.loadTokens();
    credentialsHook.loadCredentials();
    personasHook.loadPersonas();
    grackleClient.getSetting({ key: SETTING_KEY_DEFAULT_PERSONA }).then(
      (resp) => { setAppDefaultPersonaIdState(resp.value); },
      () => {},
    );
    grackleClient.getSetting({ key: SETTING_KEY_ONBOARDING_COMPLETED }).then(
      (resp) => { setOnboardingCompleted(resp.value === "true"); },
      () => {},
    );
    // Load an initial/global task list (server treats omitted workspaceId as "all workspaces",
    // which includes any workspace-less tasks such as the root task)
    tasksHook.loadAllTasks();
    sendFn({ type: "subscribe_all" });
  }

  function onDisconnect(): void {
    workspacesHook.onDisconnect();
    tasksHook.onDisconnect();
  }

  const refresh = useCallback(() => {
    environmentsHook.loadEnvironments();
    sessionsHook.loadSessions();
    workspacesHook.loadWorkspaces();
    tokensHook.loadTokens();
  }, [environmentsHook.loadEnvironments, sessionsHook.loadSessions, workspacesHook.loadWorkspaces, tokensHook.loadTokens]);

  return {
    connected,
    send,
    environments: environmentsHook.environments,
    sessions: sessionsHook.sessions,
    events: sessionsHook.events,
    eventsDropped: sessionsHook.eventsDropped,
    lastSpawnedId: sessionsHook.lastSpawnedId,
    workspaces: workspacesHook.workspaces,
    tasks: tasksHook.tasks,
    findings: findingsHook.findings,
    tokens: tokensHook.tokens,
    spawn: sessionsHook.spawn,
    sendInput: sessionsHook.sendInput,
    kill: sessionsHook.kill,
    refresh,
    loadSessionEvents: sessionsHook.loadSessionEvents,
    clearEvents: sessionsHook.clearEvents,
    loadWorkspaces: workspacesHook.loadWorkspaces,
    createWorkspace: workspacesHook.createWorkspace,
    archiveWorkspace: workspacesHook.archiveWorkspace,
    updateWorkspace: workspacesHook.updateWorkspace,
    loadTasks: tasksHook.loadTasks,
    loadAllTasks: tasksHook.loadAllTasks,
    createTask: tasksHook.createTask,
    startTask: tasksHook.startTask,
    stopTask: tasksHook.stopTask,
    completeTask: tasksHook.completeTask,
    resumeTask: tasksHook.resumeTask,
    updateTask: tasksHook.updateTask,
    deleteTask: tasksHook.deleteTask,
    loadFindings: findingsHook.loadFindings,
    postFinding: findingsHook.postFinding,
    loadEnvironments: environmentsHook.loadEnvironments,
    addEnvironment: environmentsHook.addEnvironment,
    updateEnvironment: environmentsHook.updateEnvironment,
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
    workspaceCreating: workspacesHook.workspaceCreating,
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
    usageCache,
    loadUsage,
    knowledge: knowledgeHook,
  };
}
