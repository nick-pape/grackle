/**
 * Type-safe mock factory for `@grackle-ai/database`.
 *
 * Each store mock is typed against its interface from `@grackle-ai/database`,
 * so adding a method to a store interface without updating this factory
 * fails the build immediately.
 *
 * Usage in test files:
 * ```typescript
 * vi.mock("@grackle-ai/database", async () => {
 *   const { createDatabaseMock } = await import("@grackle-ai/test-utils");
 *   return createDatabaseMock();
 * });
 * ```
 */
import { vi, type Mock } from "vitest";
import type {
  SessionStore,
  TaskStore,
  EnvironmentRegistry,
  WorkspaceStore,
  PersonaStore,
  AgentStore,
  ComponentStore,
  SettingsStore,
  TokenStore,
  CredentialProviderStore,
  ScheduleStore,
  EscalationStore,
  WorkspaceEnvironmentLinkStore,
  DispatchQueueStore,
  PluginStore,
  GitHubAccountStore,
  ChannelGrantStore,
  EventStore,
  StreamMessageStore,
  SessionActionStore,
} from "@grackle-ai/database";

/** A store where every function is replaced with a vitest Mock. */
type MockedStore<T> = {
  [K in keyof T]: T[K] extends (...args: infer _A) => infer _R ? Mock : T[K];
};

/** Create a typed mock of the session store. */
function createSessionStoreMock(): MockedStore<SessionStore> {
  return {
    createSession: vi.fn(),
    getSession: vi.fn(() => undefined),
    listSessions: vi.fn(() => []),
    listByEnv: vi.fn(() => []),
    listSessionsForTask: vi.fn(() => []),
    listSessionsByParent: vi.fn(() => []),
    listSessionsByTaskIds: vi.fn(() => []),
    getLatestSessionForTask: vi.fn(() => undefined),
    getLatestSessionsByTaskIds: vi.fn(() => new Map()),
    getActiveForEnv: vi.fn(() => undefined),
    getAllActiveForEnv: vi.fn(() => []),
    getActiveSessionsForTask: vi.fn(() => []),
    getSuspendedForEnv: vi.fn(() => []),
    getChildSessions: vi.fn(() => []),
    updateSession: vi.fn(),
    updateSessionStatus: vi.fn(),
    updateSessionUsage: vi.fn(),
    updateRuntimeSessionId: vi.fn(),
    incrementTurns: vi.fn(),
    suspendSession: vi.fn(),
    reanimateSession: vi.fn(),
    setSigtermSentAt: vi.fn(),
    clearSigtermSentAt: vi.fn(),
    setSessionTask: vi.fn(),
    deleteByEnvironment: vi.fn(),
    countActiveForEnvironment: vi.fn(() => 0),
    listRunningSubagentChildren: vi.fn(() => []),
    countActiveGlobal: vi.fn(() => 0),
    aggregateUsage: vi.fn(() => ({
      inputTokens: 0,
      outputTokens: 0,
      costMillicents: 0,
      sessionCount: 0,
    })),
  };
}

/** Create a typed mock of the task store. */
function createTaskStoreMock(): MockedStore<TaskStore> {
  return {
    createTask: vi.fn(),
    insertTask: vi.fn(),
    getTask: vi.fn(() => undefined),
    listTasks: vi.fn(() => []),
    updateTask: vi.fn(),
    updateTaskStatus: vi.fn(),
    updateTaskBudget: vi.fn(),
    updateTaskInjectKnowledge: vi.fn(),
    setTaskWorkspace: vi.fn(),
    setWorkpad: vi.fn(),
    setTaskScheduleId: vi.fn(),
    setTaskDependsOn: vi.fn(),
    markTaskComplete: vi.fn(),
    deleteTask: vi.fn(() => 0),
    getUnblockedTasks: vi.fn(() => []),
    checkAndUnblock: vi.fn(() => []),
    areDependenciesMet: vi.fn(() => true),
    detectDependencyCycle: vi.fn(() => null),
    buildChildIdsMap: vi.fn(() => new Map()),
    getChildren: vi.fn(() => []),
    getDescendants: vi.fn(() => []),
    getAncestors: vi.fn(() => []),
    getChildStatusCounts: vi.fn(() => ({})),
    reparentTask: vi.fn(),
    getOrphanedTasks: vi.fn(() => []),
    getRootTaskForAgent: vi.fn(() => undefined),
    getTasksForAgent: vi.fn(() => []),
  };
}

/** Create a typed mock of the environment registry. */
function createEnvRegistryMock(): MockedStore<EnvironmentRegistry> {
  return {
    listEnvironments: vi.fn(() => []),
    getEnvironment: vi.fn(() => undefined),
    addEnvironment: vi.fn(),
    removeEnvironment: vi.fn(),
    updateEnvironmentStatus: vi.fn(),
    markBootstrapped: vi.fn(),
    setEnvInfo: vi.fn(),
    updateAdapterConfig: vi.fn(),
    updateEnvironment: vi.fn(),
    updateDefaultRuntime: vi.fn(),
    resetAllStatuses: vi.fn(),
  };
}

/** Create a typed mock of the workspace store. */
function createWorkspaceStoreMock(): MockedStore<WorkspaceStore> {
  return {
    createWorkspace: vi.fn(),
    createWorkspaceAndLink: vi.fn(),
    getWorkspace: vi.fn(() => undefined),
    listWorkspaces: vi.fn(() => []),
    updateWorkspace: vi.fn(),
    archiveWorkspace: vi.fn(),
    countWorkspacesByEnvironment: vi.fn(() => 0),
  };
}

/** Create a typed mock of the persona store. */
function createPersonaStoreMock(): MockedStore<PersonaStore> {
  return {
    createPersona: vi.fn(),
    getPersona: vi.fn(() => undefined),
    getPersonaByName: vi.fn(() => undefined),
    listPersonas: vi.fn(() => []),
    updatePersona: vi.fn(),
    deletePersona: vi.fn(),
  };
}

/** Create a typed mock of the agent store. */
function createAgentStoreMock(): MockedStore<AgentStore> {
  return {
    listAgents: vi.fn(() => []),
    getAgent: vi.fn(() => undefined),
    getAgentByName: vi.fn(() => undefined),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    getAgentsByEnvironment: vi.fn(() => []),
  };
}

/** Create a typed mock of the component store. */
function createComponentStoreMock(): MockedStore<ComponentStore> {
  return {
    registerComponent: vi.fn(),
    updateComponent: vi.fn(() => false),
    getComponent: vi.fn(() => undefined),
    findComponentByName: vi.fn(() => undefined),
    listComponents: vi.fn(() => []),
    deleteComponent: vi.fn(() => false),
    setPromoted: vi.fn(() => false),
  };
}

/** Create a typed mock of the settings store. */
function createSettingsStoreMock(): MockedStore<SettingsStore> {
  return {
    getSetting: vi.fn(() => undefined),
    setSetting: vi.fn(),
    isAllowedSettingKey: vi.fn(() => true),
  };
}

/** Create a typed mock of the token store. */
function createTokenStoreMock(): MockedStore<TokenStore> {
  return {
    setToken: vi.fn(),
    deleteToken: vi.fn(),
    listTokens: vi.fn(() => []),
    getBundle: vi.fn(() => ({ tokens: [] })) as Mock,
  };
}

/** Create a typed mock of the credential provider store. */
function createCredentialProvidersMock(): MockedStore<CredentialProviderStore> {
  return {
    getCredentialProviders: vi.fn(() => ({
      claude: "off" as const,
      github: "off" as const,
      copilot: "off" as const,
      codex: "off" as const,
      goose: "off" as const,
    })),
    setCredentialProviders: vi.fn(),
    parseCredentialProviderConfig: vi.fn(),
    isValidCredentialProviderConfig: vi.fn(() => true),
  };
}

/** Create a typed mock of the schedule store. */
function createScheduleStoreMock(): MockedStore<ScheduleStore> {
  return {
    createSchedule: vi.fn(),
    getSchedule: vi.fn(() => undefined),
    listSchedules: vi.fn(() => []),
    updateSchedule: vi.fn(),
    getHeartbeatForTask: vi.fn(() => undefined),
    deleteSchedule: vi.fn(),
    getDueSchedules: vi.fn(() => []),
    advanceSchedule: vi.fn(),
    setScheduleEnabled: vi.fn(),
  };
}

/** Create a typed mock of the escalation store. */
function createEscalationStoreMock(): MockedStore<EscalationStore> {
  return {
    createEscalation: vi.fn(),
    getEscalation: vi.fn(() => undefined),
    listEscalations: vi.fn(() => []),
    listPendingEscalations: vi.fn(() => []),
    updateEscalationStatus: vi.fn(),
  };
}

/** Create a typed mock of the workspace-environment link store. */
function createWorkspaceEnvironmentLinkStoreMock(): MockedStore<WorkspaceEnvironmentLinkStore> {
  return {
    linkEnvironment: vi.fn(),
    unlinkEnvironment: vi.fn(),
    unlinkEnvironmentIfNotLast: vi.fn(),
    getLinkedEnvironmentIds: vi.fn(() => []),
    getLinkedEnvironmentIdsByWorkspaces: vi.fn(() => new Map()),
    getWorkspaceIdsLinkedToEnvironment: vi.fn(() => []),
    isLinked: vi.fn(() => false),
    countLinksForEnvironment: vi.fn(() => 0),
    deleteLinksForEnvironment: vi.fn(),
    deleteLinksForWorkspace: vi.fn(),
  };
}

/** Create a typed mock of the dispatch queue store. */
function createDispatchQueueStoreMock(): MockedStore<DispatchQueueStore> {
  return {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    getByTaskId: vi.fn(() => undefined),
    listPending: vi.fn(() => []),
    listPendingForEnvironment: vi.fn(() => []),
  };
}

/** Create a typed mock of the plugin store. */
function createPluginStoreMock(): MockedStore<PluginStore> {
  return {
    getPluginEnabled: vi.fn(() => undefined),
    getPlugin: vi.fn(() => undefined),
    listPlugins: vi.fn(() => []),
    setPluginEnabled: vi.fn(),
  };
}

/** Create a typed mock of the GitHub account store. */
function createGitHubAccountStoreMock(): MockedStore<GitHubAccountStore> {
  return {
    addGitHubAccount: vi.fn(() => "mock-id"),
    getGitHubAccount: vi.fn(() => undefined),
    listGitHubAccounts: vi.fn(() => []),
    getDefaultGitHubAccount: vi.fn(() => undefined),
    findGitHubAccountByLabel: vi.fn(() => undefined),
    findGitHubAccountByUsername: vi.fn(() => undefined),
    updateGitHubAccount: vi.fn(),
    removeGitHubAccount: vi.fn(),
    resolveStoredGitHubToken: vi.fn(() => undefined),
  };
}

/** Create a typed mock of the channel grant store. */
function createChannelGrantStoreMock(): MockedStore<ChannelGrantStore> {
  return {
    createGrant: vi.fn(),
    getGrant: vi.fn(() => undefined),
    listGrants: vi.fn(() => []),
    revokeGrant: vi.fn(),
    deleteGrant: vi.fn(),
  };
}

/** Create a typed mock of the event store. */
function createEventStoreMock(): MockedStore<EventStore> {
  return {
    persistEvent: vi.fn(),
    queryDomainEvents: vi.fn(() => []),
  };
}

/** Create a typed mock of the stream message store. */
function createStreamMessageStoreMock(): MockedStore<StreamMessageStore> {
  return {
    persistStreamMessage: vi.fn(),
    queryStreamMessages: vi.fn(() => []),
  };
}

/** Create a typed mock of the session action store. */
function createSessionActionStoreMock(): MockedStore<SessionActionStore> {
  return {
    persistSessionAction: vi.fn(),
    querySessionActions: vi.fn(() => []),
  };
}

/** Create mock store registry functions that mirror real throw-until-initialized semantics. */
function createStoreRegistryMock(): {
  setDatabaseStores: Mock;
  getDatabaseStores: Mock;
  clearDatabaseStores: Mock;
} {
  let stored: unknown;
  return {
    setDatabaseStores: vi.fn((s: unknown) => {
      stored = s;
    }),
    getDatabaseStores: vi.fn(() => {
      if (!stored) {
        throw new Error("Database stores not initialized. Call setDatabaseStores() at startup.");
      }
      return stored;
    }),
    clearDatabaseStores: vi.fn(() => {
      stored = undefined;
    }),
  };
}

/**
 * Create a complete mock of the `@grackle-ai/database` barrel export.
 *
 * Each store namespace is typed against its interface, so a missing or
 * mistyped method fails the build. Smart defaults return empty arrays,
 * undefined, or zero values as appropriate.
 */
export function createDatabaseMock(): Record<string, unknown> {
  const eventStore = createEventStoreMock();
  const streamMessageStore = createStreamMessageStoreMock();
  const sessionActionStore = createSessionActionStoreMock();

  return {
    db: {},
    sqlite: undefined,
    openDatabase: vi.fn(),
    initDatabase: vi.fn(),
    seedDatabase: vi.fn(),
    schema: {},

    sessionStore: createSessionStoreMock(),
    taskStore: createTaskStoreMock(),
    envRegistry: createEnvRegistryMock(),
    workspaceStore: createWorkspaceStoreMock(),
    personaStore: createPersonaStoreMock(),
    agentStore: createAgentStoreMock(),
    componentStore: createComponentStoreMock(),
    settingsStore: createSettingsStoreMock(),
    tokenStore: createTokenStoreMock(),
    credentialProviders: createCredentialProvidersMock(),
    scheduleStore: createScheduleStoreMock(),
    escalationStore: createEscalationStoreMock(),
    workspaceEnvironmentLinkStore: createWorkspaceEnvironmentLinkStoreMock(),
    dispatchQueueStore: createDispatchQueueStoreMock(),
    pluginStore: createPluginStoreMock(),
    githubAccountStore: createGitHubAccountStoreMock(),
    channelGrantStore: createChannelGrantStoreMock(),

    // Direct barrel re-exports (event/stream/action stores)
    persistEvent: eventStore.persistEvent,
    queryDomainEvents: eventStore.queryDomainEvents,
    persistStreamMessage: streamMessageStore.persistStreamMessage,
    queryStreamMessages: streamMessageStore.queryStreamMessages,
    persistSessionAction: sessionActionStore.persistSessionAction,
    querySessionActions: sessionActionStore.querySessionActions,

    // Direct barrel re-exports (constants and functions)
    isAllowedSettingKey: vi.fn(() => true),
    WRITABLE_SETTING_KEYS: new Set(["default_persona_id", "onboarding_completed"]),
    VALID_PROVIDERS: ["claude", "github", "copilot", "codex", "goose"],
    VALID_CLAUDE_VALUES: new Set(["off", "subscription", "api_key"]),
    VALID_TOGGLE_VALUES: new Set(["off", "on"]),
    parseCredentialProviderConfig: vi.fn(),
    isValidCredentialProviderConfig: vi.fn(() => true),

    // Store registry — mirrors real semantics (throws until initialized)
    ...createStoreRegistryMock(),

    // Utilities
    grackleHome: "/tmp/test-grackle",
    safeParseJsonArray: (value: string | null | undefined): string[] => {
      if (!value) {
        return [];
      }
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
          ? parsed.filter((item: unknown): item is string => typeof item === "string")
          : [];
      } catch {
        return [];
      }
    },
    slugify: (text: string): string =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40),
    encrypt: vi.fn((x: unknown) => x),
    decrypt: vi.fn((x: unknown) => x),
  };
}
