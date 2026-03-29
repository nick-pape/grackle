/**
 * Composition hook that wires together all domain hooks over a unified
 * ConnectRPC event stream. This is the only hook that components consume
 * (via {@link GrackleContext}).
 *
 * @module
 */

import { useCallback, useState } from "react";
import type { GrackleEvent, UsageStats, UseGrackleSocketResult } from "@grackle-ai/web-components";
import { useEventStream } from "./useEventStream.js";
import { eventTypeToString } from "@grackle-ai/common";
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
import { useNotifications } from "./useNotifications.js";
import { grackleClient } from "./useGrackleClient.js";
import { protoToUsageStats } from "./proto-converters.js";

// ─── Re-exports ───────────────────────────────────────────────────────────────
// Keep consumer imports (e.g. `from "../hooks/useGrackleSocket.js"`) working.

export type {
  Codespace,
  CredentialProviderConfig,
  Environment,
  FindingData,
  GrackleEvent,
  PersonaData,
  ProvisionStatus,
  SendFunction,
  Session,
  SessionEvent,
  TaskData,
  TokenInfo,
  UseGrackleSocketResult,
  WsMessage,
  Workspace,
} from "@grackle-ai/web-components";

export { isGrackleEvent } from "@grackle-ai/web-components";

// ─── Composition hook ─────────────────────────────────────────────────────────

/**
 * Top-level hook that composes all domain hooks over a unified ConnectRPC
 * event stream. Domain hooks are called first (React hook order requirement),
 * then {@link useEventStream} subscribes to `StreamEvents` and routes
 * session/domain events to the appropriate hooks via refs.
 *
 * @returns The full Grackle client state and actions.
 */
export function useGrackleSocket(): UseGrackleSocketResult {
  // --- Settings state ---

  const [appDefaultPersonaId, setAppDefaultPersonaIdState] = useState("");
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | undefined>(undefined);
  const [usageCache, setUsageCache] = useState<Record<string, UsageStats>>({});

  // --- Domain hooks ---

  const environmentsHook = useEnvironments();
  const sessionsHook = useSessions();
  const workspacesHook = useWorkspaces();
  const tasksHook = useTasks();
  const findingsHook = useFindings();
  const tokensHook = useTokens();
  const credentialsHook = useCredentials();
  const codespacesHook = useCodespaces();
  const personasHook = usePersonas();
  const knowledgeHook = useKnowledge();
  const notificationsHook = useNotifications();

  // --- Transport (ConnectRPC server-streaming) ---

  const { connected } = useEventStream({
    onSessionEvent: (evt) => {
      sessionsHook.handleSessionEvent({
        sessionId: evt.sessionId,
        eventType: eventTypeToString(evt.type),
        timestamp: evt.timestamp,
        content: evt.content,
        raw: evt.raw || undefined,
      });
    },
    onDomainEvent: (evt) => {
      try {
        const payload = JSON.parse(evt.payloadJson) as Record<string, unknown>;
        routeDomainEvent({ id: evt.id, type: evt.type, timestamp: evt.timestamp, payload });
      } catch {
        console.warn("[grackle] Failed to parse domain event payloadJson:", evt.payloadJson);
      }
    },
    onConnect: onStreamConnect,
    onDisconnect: onStreamDisconnect,
  });

  // --- Settings helpers ---

  /** Key used for the app-level default persona setting. */
  const SETTING_KEY_DEFAULT_PERSONA = "default_persona_id";

  /** Key used for the onboarding completed setting. */
  const SETTING_KEY_ONBOARDING_COMPLETED = "onboarding_completed";

  const setAppDefaultPersonaId = useCallback(
    async (personaId: string): Promise<void> => {
      const response = await grackleClient.setSetting({ key: SETTING_KEY_DEFAULT_PERSONA, value: personaId });
      setAppDefaultPersonaIdState(response.value);
    },
    [],
  );

  const completeOnboarding = useCallback(async () => {
    setOnboardingCompleted(true);
    try {
      await grackleClient.setSetting({ key: SETTING_KEY_ONBOARDING_COMPLETED, value: "true" });
    } catch {
      // empty
    }
  }, []);

  const loadUsage = useCallback(
    async (scope: string, id: string) => {
      try {
        const resp = await grackleClient.getUsage({ scope, id });
        const key = `${scope}:${id}`;
        setUsageCache((prev) => ({
          ...prev,
          [key]: protoToUsageStats(resp),
        }));
      } catch {
        // empty
      }
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
        sessionsHook.loadSessions().catch(() => {});
      }
      return;
    }
    if (workspacesHook.handleEvent(event)) { return; }
    if (tasksHook.handleEvent(event)) {
      // task.started also needs a session refresh (cross-concern)
      if (event.type === "task.started") {
        sessionsHook.loadSessions().catch(() => {});
      }
      return;
    }
    if (findingsHook.handleEvent(event)) { return; }
    if (tokensHook.handleEvent(event)) { return; }
    if (credentialsHook.handleEvent(event)) { return; }
    if (personasHook.handleEvent(event)) { return; }
    if (knowledgeHook.handleEvent(event)) { return; }
    if (notificationsHook.handleEvent(event)) { return; }
  }

  async function onStreamConnect(): Promise<void> {
    // Fire-and-forget: all loads run concurrently
    environmentsHook.loadEnvironments().catch(() => {});
    sessionsHook.loadSessions().catch(() => {});
    workspacesHook.loadWorkspaces().catch(() => {});
    tokensHook.loadTokens().catch(() => {});
    credentialsHook.loadCredentials().catch(() => {});
    personasHook.loadPersonas().catch(() => {});
    tasksHook.loadAllTasks().catch(() => {});

    try {
      const personaResp = await grackleClient.getSetting({ key: SETTING_KEY_DEFAULT_PERSONA });
      setAppDefaultPersonaIdState(personaResp.value);
    } catch {
      // empty
    }
    try {
      const onboardingResp = await grackleClient.getSetting({ key: SETTING_KEY_ONBOARDING_COMPLETED });
      setOnboardingCompleted(onboardingResp.value === "true");
    } catch {
      // empty
    }
  }

  function onStreamDisconnect(): void {
    workspacesHook.onDisconnect();
    tasksHook.onDisconnect();
  }

  const refresh = useCallback(() => {
    environmentsHook.loadEnvironments().catch(() => {});
    sessionsHook.loadSessions().catch(() => {});
    workspacesHook.loadWorkspaces().catch(() => {});
    tokensHook.loadTokens().catch(() => {});
  }, [environmentsHook.loadEnvironments, sessionsHook.loadSessions, workspacesHook.loadWorkspaces, tokensHook.loadTokens]);

  return {
    connected,
    environmentsLoading: environmentsHook.environmentsLoading,
    sessionsLoading: sessionsHook.sessionsLoading,
    workspacesLoading: workspacesHook.workspacesLoading,
    tasksLoading: tasksHook.tasksLoading,
    tokensLoading: tokensHook.tokensLoading,
    credentialsLoading: credentialsHook.credentialsLoading,
    personasLoading: personasHook.personasLoading,
    environments: environmentsHook.environments,
    sessions: sessionsHook.sessions,
    events: sessionsHook.events,
    eventsDropped: sessionsHook.eventsDropped,
    lastSpawnedId: sessionsHook.lastSpawnedId,
    workspaces: workspacesHook.workspaces,
    tasks: tasksHook.tasks,
    findings: findingsHook.findings,
    selectedFinding: findingsHook.selectedFinding,
    findingLoading: findingsHook.findingLoading,
    findingsLoading: findingsHook.findingsLoading,
    tokens: tokensHook.tokens,
    spawn: sessionsHook.spawn,
    sendInput: sessionsHook.sendInput,
    kill: sessionsHook.kill,
    stopGraceful: sessionsHook.stopGraceful,
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
    loadAllFindings: findingsHook.loadAllFindings,
    loadFinding: findingsHook.loadFinding,
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
    environmentOperationError: environmentsHook.operationError,
    clearEnvironmentOperationError: environmentsHook.clearOperationError,
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
