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
import type { DomainHook } from "./domainHook.js";
import { useManifest } from "../context/ManifestContext.js";
import { buildActiveHookKeys } from "../plugin-registry.js";
import { useEnvironments } from "./useEnvironments.js";
import { useSessions } from "./useSessions.js";
import { useWorkspaces } from "./useWorkspaces.js";
import { useTasks } from "./useTasks.js";
import { useFindings } from "./useFindings.js";
import { useTokens } from "./useTokens.js";
import { useCredentials } from "./useCredentials.js";
import { useCodespaces } from "./useCodespaces.js";
import { usePersonas } from "./usePersonas.js";
import { useSchedules } from "./useSchedules.js";
import { useKnowledge } from "./useKnowledge.js";
import { useNotifications } from "./useNotifications.js";
import { coreClient as grackleClient } from "./useGrackleClient.js";
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
  ScheduleData,
  SendFunction,
  Session,
  SessionEvent,
  TaskData,
  TokenInfo,
  UseGrackleSocketResult,
  UseEnvironmentsResult,
  UseSessionsResult,
  UseWorkspacesResult,
  UseTasksResult,
  UseFindingsResult,
  UseTokensResult,
  UseCredentialsResult,
  UseCodespacesResult,
  UsePersonasResult,
  UseSchedulesResult,
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

  // --- Manifest (which plugins are active) ---
  // Must be called before any domain hook to keep React hook call order stable.

  const { pluginNames } = useManifest();
  const activeHookKeys = buildActiveHookKeys(pluginNames);

  // --- Domain hooks (all called unconditionally — Rules of Hooks) ---

  const environmentsHook = useEnvironments();
  const sessionsHook = useSessions();
  const workspacesHook = useWorkspaces();
  const tasksHook = useTasks();
  const findingsHook = useFindings();
  const tokensHook = useTokens();
  const credentialsHook = useCredentials();
  const codespacesHook = useCodespaces();
  const personasHook = usePersonas();
  const schedulesHook = useSchedules();
  const knowledgeHook = useKnowledge();
  const notificationsHook = useNotifications();

  // --- Domain hook registry ---
  // Only hooks whose plugin is active are registered for onConnect() / handleEvent().
  // All hooks are still instantiated above (Rules of Hooks requires unconditional calls).
  const domainHooks: DomainHook[] = [
    ...(activeHookKeys.has("environments") ? [environmentsHook.domainHook] : []),
    ...(activeHookKeys.has("sessions")     ? [sessionsHook.domainHook]     : []),
    ...(activeHookKeys.has("workspaces")   ? [workspacesHook.domainHook]   : []),
    ...(activeHookKeys.has("tasks")        ? [tasksHook.domainHook]        : []),
    ...(activeHookKeys.has("findings")     ? [findingsHook.domainHook]     : []),
    ...(activeHookKeys.has("tokens")       ? [tokensHook.domainHook]       : []),
    ...(activeHookKeys.has("credentials")  ? [credentialsHook.domainHook]  : []),
    ...(activeHookKeys.has("codespaces")   ? [codespacesHook.domainHook]   : []),
    ...(activeHookKeys.has("personas")     ? [personasHook.domainHook]     : []),
    ...(activeHookKeys.has("schedules")    ? [schedulesHook.domainHook]    : []),
    ...(activeHookKeys.has("knowledge")    ? [knowledgeHook.domainHook]    : []),
    ...(activeHookKeys.has("notifications") ? [notificationsHook.domainHook] : []),
  ];

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

    // Settings events (not a domain hook — managed directly here)
    if (event.type === "setting.changed") {
      if (key === SETTING_KEY_DEFAULT_PERSONA) {
        setAppDefaultPersonaIdState(value ?? "");
      }
      if (key === SETTING_KEY_ONBOARDING_COMPLETED) {
        setOnboardingCompleted(value === "true");
      }
      return;
    }

    // Route to first matching domain hook
    for (const hook of domainHooks) {
      if (hook.handleEvent(event)) {
        break;
      }
    }

    // Cross-concern side effects: sessions need reloading when environments
    // or tasks change (session list includes environment/task references)
    if (
      event.type === "environment.removed" ||
      event.type === "environment.changed" ||
      event.type === "task.started"
    ) {
      sessionsHook.loadSessions().catch(() => {});
    }
  }

  async function onStreamConnect(): Promise<void> {
    // Fire-and-forget: domain hooks and settings reload concurrently
    for (const h of domainHooks) {
      h.onConnect().catch(() => {});
    }

    // Settings (not a domain hook — managed directly here)
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
    domainHooks.forEach((h) => h.onDisconnect());
  }

  const refresh = useCallback(() => {
    environmentsHook.loadEnvironments().catch(() => {});
    sessionsHook.loadSessions().catch(() => {});
    workspacesHook.loadWorkspaces().catch(() => {});
    tokensHook.loadTokens().catch(() => {});
  }, [environmentsHook.loadEnvironments, sessionsHook.loadSessions, workspacesHook.loadWorkspaces, tokensHook.loadTokens]);

  return {
    connected,
    environments: {
      environments: environmentsHook.environments,
      environmentsLoading: environmentsHook.environmentsLoading,
      provisionStatus: environmentsHook.provisionStatus,
      operationError: environmentsHook.operationError,
      clearOperationError: environmentsHook.clearOperationError,
      loadEnvironments: environmentsHook.loadEnvironments,
      addEnvironment: environmentsHook.addEnvironment,
      updateEnvironment: environmentsHook.updateEnvironment,
      provisionEnvironment: environmentsHook.provisionEnvironment,
      stopEnvironment: environmentsHook.stopEnvironment,
      removeEnvironment: environmentsHook.removeEnvironment,
      domainHook: environmentsHook.domainHook,
    },
    sessions: {
      sessions: sessionsHook.sessions,
      sessionsLoading: sessionsHook.sessionsLoading,
      events: sessionsHook.events,
      eventsDropped: sessionsHook.eventsDropped,
      lastSpawnedId: sessionsHook.lastSpawnedId,
      taskSessions: sessionsHook.taskSessions,
      spawn: sessionsHook.spawn,
      sendInput: sessionsHook.sendInput,
      kill: sessionsHook.kill,
      stopGraceful: sessionsHook.stopGraceful,
      loadSessionEvents: sessionsHook.loadSessionEvents,
      clearEvents: sessionsHook.clearEvents,
      loadTaskSessions: sessionsHook.loadTaskSessions,
      domainHook: sessionsHook.domainHook,
    },
    workspaces: {
      workspaces: workspacesHook.workspaces,
      workspacesLoading: workspacesHook.workspacesLoading,
      workspaceCreating: workspacesHook.workspaceCreating,
      loadWorkspaces: workspacesHook.loadWorkspaces,
      createWorkspace: workspacesHook.createWorkspace,
      archiveWorkspace: workspacesHook.archiveWorkspace,
      updateWorkspace: workspacesHook.updateWorkspace,
      linkEnvironment: workspacesHook.linkEnvironment,
      unlinkEnvironment: workspacesHook.unlinkEnvironment,
      linkOperationError: workspacesHook.linkOperationError,
      clearLinkOperationError: workspacesHook.clearLinkOperationError,
      domainHook: workspacesHook.domainHook,
    },
    tasks: {
      tasks: tasksHook.tasks,
      tasksLoading: tasksHook.tasksLoading,
      taskStartingId: tasksHook.taskStartingId,
      loadTasks: tasksHook.loadTasks,
      loadAllTasks: tasksHook.loadAllTasks,
      createTask: tasksHook.createTask,
      startTask: tasksHook.startTask,
      stopTask: tasksHook.stopTask,
      completeTask: tasksHook.completeTask,
      resumeTask: tasksHook.resumeTask,
      updateTask: tasksHook.updateTask,
      deleteTask: tasksHook.deleteTask,
      domainHook: tasksHook.domainHook,
    },
    findings: {
      findings: findingsHook.findings,
      selectedFinding: findingsHook.selectedFinding,
      findingLoading: findingsHook.findingLoading,
      findingsLoading: findingsHook.findingsLoading,
      loadFindings: findingsHook.loadFindings,
      loadAllFindings: findingsHook.loadAllFindings,
      loadFinding: findingsHook.loadFinding,
      postFinding: findingsHook.postFinding,
      domainHook: findingsHook.domainHook,
    },
    tokens: {
      tokens: tokensHook.tokens,
      tokensLoading: tokensHook.tokensLoading,
      loadTokens: tokensHook.loadTokens,
      setToken: tokensHook.setToken,
      deleteToken: tokensHook.deleteToken,
      domainHook: tokensHook.domainHook,
    },
    credentials: {
      credentialProviders: credentialsHook.credentialProviders,
      credentialsLoading: credentialsHook.credentialsLoading,
      updateCredentialProviders: credentialsHook.updateCredentialProviders,
      domainHook: credentialsHook.domainHook,
    },
    codespaces: {
      codespaces: codespacesHook.codespaces,
      codespaceError: codespacesHook.codespaceError,
      codespaceListError: codespacesHook.codespaceListError,
      codespaceCreating: codespacesHook.codespaceCreating,
      listCodespaces: codespacesHook.listCodespaces,
      createCodespace: codespacesHook.createCodespace,
      domainHook: codespacesHook.domainHook,
    },
    personas: {
      personas: personasHook.personas,
      personasLoading: personasHook.personasLoading,
      createPersona: personasHook.createPersona,
      updatePersona: personasHook.updatePersona,
      deletePersona: personasHook.deletePersona,
      domainHook: personasHook.domainHook,
    },
    schedules: {
      schedules: schedulesHook.schedules,
      schedulesLoading: schedulesHook.schedulesLoading,
      createSchedule: schedulesHook.createSchedule,
      updateSchedule: schedulesHook.updateSchedule,
      deleteSchedule: schedulesHook.deleteSchedule,
      domainHook: schedulesHook.domainHook,
    },
    knowledge: knowledgeHook,
    appDefaultPersonaId,
    setAppDefaultPersonaId,
    onboardingCompleted,
    completeOnboarding,
    usageCache,
    loadUsage,
    refresh,
  };
}
