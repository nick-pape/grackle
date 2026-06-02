/**
 * Composition hook that wires together all domain hooks over a unified
 * ConnectRPC event stream. This is the only hook that components consume
 * (via {@link GrackleContext}).
 *
 * @module
 */

import { useCallback, useMemo, useState } from "react";
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
import { useTokens } from "./useTokens.js";
import { useCredentials } from "./useCredentials.js";
import { useCodespaces } from "./useCodespaces.js";
import { useDockerContainers } from "./useDockerContainers.js";
import { usePersonas } from "./usePersonas.js";
import { useAgents } from "./useAgents.js";
import { useSchedules } from "./useSchedules.js";
import { useKnowledge } from "./useKnowledge.js";
import { useNotifications } from "./useNotifications.js";
import { useStreams } from "./useStreams.js";
import { usePlugins } from "./usePlugins.js";
import { useGitHubAccounts } from "./useGitHubAccounts.js";
import { useResources } from "./useResources.js";
import { useDocuments } from "./useDocuments.js";
import { coreClient as grackleClient } from "./useGrackleClient.js";
import { protoToUsageStats } from "./proto-converters.js";

// ─── Re-exports ───────────────────────────────────────────────────────────────
// Keep consumer imports (e.g. `from "../hooks/useGrackleSocket.js"`) working.

export type {
  Codespace,
  CredentialProviderConfig,
  Environment,
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
  const tokensHook = useTokens();
  const credentialsHook = useCredentials();
  const codespacesHook = useCodespaces();
  const dockerContainersHook = useDockerContainers();
  const personasHook = usePersonas();
  const agentsHook = useAgents();
  const schedulesHook = useSchedules();
  const knowledgeHook = useKnowledge();
  const notificationsHook = useNotifications();
  const streamsHook = useStreams();
  const pluginsHook = usePlugins();
  const githubAccountsHook = useGitHubAccounts();
  const resourcesHook = useResources();
  // Live-docs pane (#1396) drives the resource bridge's read/watch actions.
  const documentsHook = useDocuments({
    readResource: resourcesHook.readResource,
    watchResource: resourcesHook.watchResource,
    unwatchResource: resourcesHook.unwatchResource,
  });

  // --- Domain hook registry ---
  // Plugin-scoped hooks are only registered when their plugin is active.
  // Core hooks (githubAccountsHook) are always registered unconditionally.
  // All hooks are still instantiated above (Rules of Hooks requires unconditional calls).
  const domainHooks: DomainHook[] = [
    ...(activeHookKeys.has("environments") ? [environmentsHook.domainHook] : []),
    ...(activeHookKeys.has("sessions") ? [sessionsHook.domainHook] : []),
    ...(activeHookKeys.has("workspaces") ? [workspacesHook.domainHook] : []),
    ...(activeHookKeys.has("tasks") ? [tasksHook.domainHook] : []),
    ...(activeHookKeys.has("tokens") ? [tokensHook.domainHook] : []),
    ...(activeHookKeys.has("credentials") ? [credentialsHook.domainHook] : []),
    ...(activeHookKeys.has("codespaces") ? [codespacesHook.domainHook] : []),
    ...(activeHookKeys.has("dockerContainers") ? [dockerContainersHook.domainHook] : []),
    ...(activeHookKeys.has("personas") ? [personasHook.domainHook] : []),
    ...(activeHookKeys.has("agents") ? [agentsHook.domainHook] : []),
    ...(activeHookKeys.has("schedules") ? [schedulesHook.domainHook] : []),
    ...(activeHookKeys.has("knowledge") ? [knowledgeHook.domainHook] : []),
    ...(activeHookKeys.has("notifications") ? [notificationsHook.domainHook] : []),
    ...(activeHookKeys.has("streams") ? [streamsHook.domainHook] : []),
    ...(activeHookKeys.has("plugins") ? [pluginsHook.domainHook] : []),
    githubAccountsHook.domainHook, // core hook — always active
    // Documents BEFORE resources: it observes resource.changed (returns false to
    // badge inactive tabs) then lets the resource bridge consume it (#1396).
    documentsHook.domainHook, // core hook — always active (live docs v0 #1396)
    resourcesHook.domainHook, // core hook — always active (AHP resource bridge #1395)
  ];

  // --- Transport (ConnectRPC server-streaming) ---

  const { connectionStatus } = useEventStream({
    onSessionEvent: (evt) => {
      sessionsHook.handleSessionEvent({
        sessionId: evt.sessionId,
        eventType: eventTypeToString(evt.type),
        timestamp: evt.timestamp,
        content: evt.content,
        raw: evt.raw || undefined,
        toolCallId: evt.toolCallId || undefined,
        turnId: evt.turnId || undefined,
        serverSeq: evt.serverSeq || undefined,
        toolError: evt.toolError || undefined,
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
    onStreamMessage: (msg) => {
      streamsHook.handleStreamMessage(msg);
    },
    onConnect: onStreamConnect,
    onDisconnect: onStreamDisconnect,
  });

  // --- Settings helpers ---

  /** Key used for the app-level default persona setting. */
  const SETTING_KEY_DEFAULT_PERSONA = "default_persona_id";

  /** Key used for the onboarding completed setting. */
  const SETTING_KEY_ONBOARDING_COMPLETED = "onboarding_completed";

  const setAppDefaultPersonaId = useCallback(async (personaId: string): Promise<void> => {
    const response = await grackleClient.setSetting({
      key: SETTING_KEY_DEFAULT_PERSONA,
      value: personaId,
    });
    setAppDefaultPersonaIdState(response.value);
  }, []);

  const completeOnboarding = useCallback(async () => {
    setOnboardingCompleted(true);
    try {
      await grackleClient.setSetting({ key: SETTING_KEY_ONBOARDING_COMPLETED, value: "true" });
    } catch {
      // empty
    }
  }, []);

  const loadUsage = useCallback(async (scope: string, id: string) => {
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
  }, []);

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
    // are removed or tasks start (session list holds env/task references).
    // environment.changed is intentionally excluded — env status flips do not
    // mutate session shape, and reloading on every reconnect attempt causes
    // the visible flash described in the deleted-codespace retry-storm bug.
    if (event.type === "environment.removed" || event.type === "task.started") {
      sessionsHook.loadSessions().catch(() => {});
    }

    // Streams need reloading when sessions start/stop (subscriber counts change)
    if (event.type === "session.started" || event.type === "session.stopped") {
      streamsHook.loadStreams().catch(() => {});
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
      const onboardingResp = await grackleClient.getSetting({
        key: SETTING_KEY_ONBOARDING_COMPLETED,
      });
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
  }, [
    environmentsHook.loadEnvironments,
    sessionsHook.loadSessions,
    workspacesHook.loadWorkspaces,
    tokensHook.loadTokens,
  ]);

  // ─── Per-domain memoized slices (#1492) ──────────────────────────────────
  // Each slice is referentially stable when its domain's state hasn't changed.

  const environmentsSlice = useMemo(
    () => ({
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
    }),
    [
      environmentsHook.environments,
      environmentsHook.environmentsLoading,
      environmentsHook.provisionStatus,
      environmentsHook.operationError,
      environmentsHook.clearOperationError,
      environmentsHook.loadEnvironments,
      environmentsHook.addEnvironment,
      environmentsHook.updateEnvironment,
      environmentsHook.provisionEnvironment,
      environmentsHook.stopEnvironment,
      environmentsHook.removeEnvironment,
      environmentsHook.domainHook,
    ],
  );

  const sessionsSlice = useMemo(
    () => ({
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
    }),
    [
      sessionsHook.sessions,
      sessionsHook.sessionsLoading,
      sessionsHook.events,
      sessionsHook.eventsDropped,
      sessionsHook.lastSpawnedId,
      sessionsHook.taskSessions,
      sessionsHook.spawn,
      sessionsHook.sendInput,
      sessionsHook.kill,
      sessionsHook.stopGraceful,
      sessionsHook.loadSessionEvents,
      sessionsHook.clearEvents,
      sessionsHook.loadTaskSessions,
      sessionsHook.domainHook,
    ],
  );

  const workspacesSlice = useMemo(
    () => ({
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
    }),
    [
      workspacesHook.workspaces,
      workspacesHook.workspacesLoading,
      workspacesHook.workspaceCreating,
      workspacesHook.loadWorkspaces,
      workspacesHook.createWorkspace,
      workspacesHook.archiveWorkspace,
      workspacesHook.updateWorkspace,
      workspacesHook.linkEnvironment,
      workspacesHook.unlinkEnvironment,
      workspacesHook.linkOperationError,
      workspacesHook.clearLinkOperationError,
      workspacesHook.domainHook,
    ],
  );

  const tasksSlice = useMemo(
    () => ({
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
    }),
    [
      tasksHook.tasks,
      tasksHook.tasksLoading,
      tasksHook.taskStartingId,
      tasksHook.loadTasks,
      tasksHook.loadAllTasks,
      tasksHook.createTask,
      tasksHook.startTask,
      tasksHook.stopTask,
      tasksHook.completeTask,
      tasksHook.resumeTask,
      tasksHook.updateTask,
      tasksHook.deleteTask,
      tasksHook.domainHook,
    ],
  );

  const tokensSlice = useMemo(
    () => ({
      tokens: tokensHook.tokens,
      tokensLoading: tokensHook.tokensLoading,
      loadTokens: tokensHook.loadTokens,
      setToken: tokensHook.setToken,
      deleteToken: tokensHook.deleteToken,
      domainHook: tokensHook.domainHook,
    }),
    [
      tokensHook.tokens,
      tokensHook.tokensLoading,
      tokensHook.loadTokens,
      tokensHook.setToken,
      tokensHook.deleteToken,
      tokensHook.domainHook,
    ],
  );

  const credentialsSlice = useMemo(
    () => ({
      credentialProviders: credentialsHook.credentialProviders,
      credentialsLoading: credentialsHook.credentialsLoading,
      updateCredentialProviders: credentialsHook.updateCredentialProviders,
      domainHook: credentialsHook.domainHook,
    }),
    [
      credentialsHook.credentialProviders,
      credentialsHook.credentialsLoading,
      credentialsHook.updateCredentialProviders,
      credentialsHook.domainHook,
    ],
  );

  const codespacesSlice = useMemo(
    () => ({
      codespaces: codespacesHook.codespaces,
      codespaceError: codespacesHook.codespaceError,
      codespaceListError: codespacesHook.codespaceListError,
      codespaceCreating: codespacesHook.codespaceCreating,
      listCodespaces: codespacesHook.listCodespaces,
      createCodespace: codespacesHook.createCodespace,
      domainHook: codespacesHook.domainHook,
    }),
    [
      codespacesHook.codespaces,
      codespacesHook.codespaceError,
      codespacesHook.codespaceListError,
      codespacesHook.codespaceCreating,
      codespacesHook.listCodespaces,
      codespacesHook.createCodespace,
      codespacesHook.domainHook,
    ],
  );

  const dockerContainersSlice = useMemo(
    () => ({
      dockerContainers: dockerContainersHook.dockerContainers,
      dockerContainersError: dockerContainersHook.dockerContainersError,
      listDockerContainers: dockerContainersHook.listDockerContainers,
      domainHook: dockerContainersHook.domainHook,
    }),
    [
      dockerContainersHook.dockerContainers,
      dockerContainersHook.dockerContainersError,
      dockerContainersHook.listDockerContainers,
      dockerContainersHook.domainHook,
    ],
  );

  const personasSlice = useMemo(
    () => ({
      personas: personasHook.personas,
      personasLoading: personasHook.personasLoading,
      createPersona: personasHook.createPersona,
      updatePersona: personasHook.updatePersona,
      deletePersona: personasHook.deletePersona,
      domainHook: personasHook.domainHook,
    }),
    [
      personasHook.personas,
      personasHook.personasLoading,
      personasHook.createPersona,
      personasHook.updatePersona,
      personasHook.deletePersona,
      personasHook.domainHook,
    ],
  );

  const agentsSlice = useMemo(
    () => ({
      agents: agentsHook.agents,
      agentsLoading: agentsHook.agentsLoading,
      createAgent: agentsHook.createAgent,
      updateAgent: agentsHook.updateAgent,
      deleteAgent: agentsHook.deleteAgent,
      domainHook: agentsHook.domainHook,
    }),
    [
      agentsHook.agents,
      agentsHook.agentsLoading,
      agentsHook.createAgent,
      agentsHook.updateAgent,
      agentsHook.deleteAgent,
      agentsHook.domainHook,
    ],
  );

  const schedulesSlice = useMemo(
    () => ({
      schedules: schedulesHook.schedules,
      schedulesLoading: schedulesHook.schedulesLoading,
      createSchedule: schedulesHook.createSchedule,
      updateSchedule: schedulesHook.updateSchedule,
      deleteSchedule: schedulesHook.deleteSchedule,
      domainHook: schedulesHook.domainHook,
    }),
    [
      schedulesHook.schedules,
      schedulesHook.schedulesLoading,
      schedulesHook.createSchedule,
      schedulesHook.updateSchedule,
      schedulesHook.deleteSchedule,
      schedulesHook.domainHook,
    ],
  );

  const streamsSlice = useMemo(
    () => ({
      streams: streamsHook.streams,
      streamsLoading: streamsHook.streamsLoading,
      streamsLoadedOnce: streamsHook.streamsLoadedOnce,
      streamsLoadError: streamsHook.streamsLoadError,
      loadStreams: streamsHook.loadStreams,
      liveMessages: streamsHook.liveMessages,
      loadTranscript: streamsHook.loadTranscript,
      handleStreamMessage: streamsHook.handleStreamMessage,
      domainHook: streamsHook.domainHook,
    }),
    [
      streamsHook.streams,
      streamsHook.streamsLoading,
      streamsHook.streamsLoadedOnce,
      streamsHook.streamsLoadError,
      streamsHook.loadStreams,
      streamsHook.liveMessages,
      streamsHook.loadTranscript,
      streamsHook.handleStreamMessage,
      streamsHook.domainHook,
    ],
  );

  const pluginsSlice = useMemo(
    () => ({
      plugins: pluginsHook.plugins,
      pluginsLoading: pluginsHook.pluginsLoading,
      loadPlugins: pluginsHook.loadPlugins,
      setPluginEnabled: pluginsHook.setPluginEnabled,
    }),
    [
      pluginsHook.plugins,
      pluginsHook.pluginsLoading,
      pluginsHook.loadPlugins,
      pluginsHook.setPluginEnabled,
    ],
  );

  const githubAccountsSlice = useMemo(
    () => ({
      githubAccounts: githubAccountsHook.githubAccounts,
      githubAccountsLoading: githubAccountsHook.githubAccountsLoading,
      loadGitHubAccounts: githubAccountsHook.loadGitHubAccounts,
      addGitHubAccount: githubAccountsHook.addGitHubAccount,
      updateGitHubAccount: githubAccountsHook.updateGitHubAccount,
      removeGitHubAccount: githubAccountsHook.removeGitHubAccount,
      importGitHubAccounts: githubAccountsHook.importGitHubAccounts,
    }),
    [
      githubAccountsHook.githubAccounts,
      githubAccountsHook.githubAccountsLoading,
      githubAccountsHook.loadGitHubAccounts,
      githubAccountsHook.addGitHubAccount,
      githubAccountsHook.updateGitHubAccount,
      githubAccountsHook.removeGitHubAccount,
      githubAccountsHook.importGitHubAccounts,
    ],
  );

  const resourcesSlice = useMemo(
    () => ({
      readResource: resourcesHook.readResource,
      getResourceContent: resourcesHook.getResourceContent,
      watchResource: resourcesHook.watchResource,
      unwatchResource: resourcesHook.unwatchResource,
    }),
    [
      resourcesHook.readResource,
      resourcesHook.getResourceContent,
      resourcesHook.watchResource,
      resourcesHook.unwatchResource,
    ],
  );

  const documentsSlice = useMemo(
    () => ({
      tabs: documentsHook.tabs,
      activeTabId: documentsHook.activeTabId,
      paneOpen: documentsHook.paneOpen,
      unseenTabIds: documentsHook.unseenTabIds,
      openDocument: documentsHook.openDocument,
      closeTab: documentsHook.closeTab,
      setActiveTab: documentsHook.setActiveTab,
    }),
    [
      documentsHook.tabs,
      documentsHook.activeTabId,
      documentsHook.paneOpen,
      documentsHook.unseenTabIds,
      documentsHook.openDocument,
      documentsHook.closeTab,
      documentsHook.setActiveTab,
    ],
  );

  // ─── Memoized aggregate (#1492) ────────────────────────────────────────────

  return useMemo(
    () => ({
      connectionStatus,
      environments: environmentsSlice,
      sessions: sessionsSlice,
      workspaces: workspacesSlice,
      tasks: tasksSlice,
      tokens: tokensSlice,
      credentials: credentialsSlice,
      codespaces: codespacesSlice,
      dockerContainers: dockerContainersSlice,
      personas: personasSlice,
      agents: agentsSlice,
      schedules: schedulesSlice,
      streams: streamsSlice,
      knowledge: knowledgeHook,
      plugins: pluginsSlice,
      githubAccounts: githubAccountsSlice,
      resources: resourcesSlice,
      documents: documentsSlice,
      appDefaultPersonaId,
      setAppDefaultPersonaId,
      onboardingCompleted,
      completeOnboarding,
      usageCache,
      loadUsage,
      refresh,
    }),
    [
      connectionStatus,
      environmentsSlice,
      sessionsSlice,
      workspacesSlice,
      tasksSlice,
      tokensSlice,
      credentialsSlice,
      codespacesSlice,
      dockerContainersSlice,
      personasSlice,
      agentsSlice,
      schedulesSlice,
      streamsSlice,
      knowledgeHook,
      pluginsSlice,
      githubAccountsSlice,
      resourcesSlice,
      documentsSlice,
      appDefaultPersonaId,
      setAppDefaultPersonaId,
      onboardingCompleted,
      completeOnboarding,
      usageCache,
      loadUsage,
      refresh,
    ],
  );
}
