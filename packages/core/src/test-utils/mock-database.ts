/**
 * Shared mock factory for `@grackle-ai/database` used by server test files.
 *
 * Usage in test files:
 * ```typescript
 * import { createDatabaseMock } from "./test-utils/mock-database.js";
 * vi.mock("@grackle-ai/database", () => createDatabaseMock());
 * ```
 *
 * All store namespaces are provided with vi.fn() stubs that return safe defaults
 * (empty arrays, undefined, etc.). Individual tests can override specific functions
 * via `vi.mocked(store.someMethod).mockReturnValue(...)`.
 */
import { vi } from "vitest";

/** Create a complete mock of the `@grackle-ai/database` barrel export. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createDatabaseMock() {
  return {
    db: {},
    sqlite: undefined,
    openDatabase: vi.fn(),
    initDatabase: vi.fn(),
    seedDatabase: vi.fn(),
    schema: {},

    sessionStore: {
      createSession: vi.fn(),
      getSession: vi.fn(() => undefined),
      listSessions: vi.fn(() => []),
      listByEnv: vi.fn(() => []),
      listSessionsForTask: vi.fn(() => []),
      listSessionsByTaskIds: vi.fn(() => []),
      getLatestSessionForTask: vi.fn(() => undefined),
      getActiveForEnv: vi.fn(() => undefined),
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
      setSessionTask: vi.fn(),
      deleteByEnvironment: vi.fn(),
      aggregateUsage: vi.fn(() => ({ inputTokens: 0, outputTokens: 0, costUsd: 0, sessionCount: 0 })),
    },

    taskStore: {
      createTask: vi.fn(),
      insertTask: vi.fn(),
      getTask: vi.fn(() => undefined),
      listTasks: vi.fn(() => []),
      updateTask: vi.fn(),
      updateTaskStatus: vi.fn(),
      markTaskComplete: vi.fn(),
      deleteTask: vi.fn(),
      setTaskWorkspace: vi.fn(),
      setTaskDependsOn: vi.fn(),
      getUnblockedTasks: vi.fn(() => []),
      checkAndUnblock: vi.fn(() => []),
      areDependenciesMet: vi.fn(() => true),
      buildChildIdsMap: vi.fn(() => new Map()),
      getChildren: vi.fn(() => []),
      getDescendants: vi.fn(() => []),
      getAncestors: vi.fn(() => []),
      getChildStatusCounts: vi.fn(() => ({})),
    },

    workspaceStore: {
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn(() => undefined),
      listWorkspaces: vi.fn(() => []),
      updateWorkspace: vi.fn(),
      archiveWorkspace: vi.fn(),
      countWorkspacesByEnvironment: vi.fn(() => 0),
    },

    personaStore: {
      createPersona: vi.fn(),
      getPersona: vi.fn(() => undefined),
      getPersonaByName: vi.fn(() => undefined),
      listPersonas: vi.fn(() => []),
      updatePersona: vi.fn(),
      deletePersona: vi.fn(),
    },

    findingStore: {
      postFinding: vi.fn(),
      queryFindings: vi.fn(() => []),
    },

    settingsStore: {
      getSetting: vi.fn(() => undefined),
      setSetting: vi.fn(),
      isAllowedSettingKey: vi.fn(() => true),
      WRITABLE_SETTING_KEYS: new Set(["default_persona_id", "onboarding_completed"]),
    },

    envRegistry: {
      listEnvironments: vi.fn(() => []),
      getEnvironment: vi.fn(() => undefined),
      addEnvironment: vi.fn(),
      removeEnvironment: vi.fn(),
      updateEnvironmentStatus: vi.fn(),
      markBootstrapped: vi.fn(),
      setEnvInfo: vi.fn(),
      updateAdapterConfig: vi.fn(),
      updateEnvironment: vi.fn(),
      resetAllStatuses: vi.fn(),
    },

    tokenStore: {
      setToken: vi.fn(),
      deleteToken: vi.fn(),
      listTokens: vi.fn(() => []),
      getBundle: vi.fn(() => ({ tokens: [] })),
    },

    credentialProviders: {
      getCredentialProviders: vi.fn(() => ({ claude: "off", github: "off", copilot: "off", codex: "off", goose: "off" })),
      setCredentialProviders: vi.fn(),
      parseCredentialProviderConfig: vi.fn(),
      isValidCredentialProviderConfig: vi.fn(() => true),
      VALID_PROVIDERS: ["claude", "github", "copilot", "codex", "goose"],
      VALID_CLAUDE_VALUES: new Set(["off", "subscription", "api_key"]),
      VALID_TOGGLE_VALUES: new Set(["off", "on"]),
    },

    // Direct barrel exports
    isAllowedSettingKey: vi.fn(() => true),
    WRITABLE_SETTING_KEYS: new Set(["default_persona_id", "onboarding_completed"]),
    VALID_PROVIDERS: ["claude", "github", "copilot", "codex", "goose"],
    VALID_CLAUDE_VALUES: new Set(["off", "subscription", "api_key"]),
    VALID_TOGGLE_VALUES: new Set(["off", "on"]),
    persistEvent: vi.fn(),

    // Utilities
    grackleHome: "/tmp/test-grackle",
    safeParseJsonArray: (value: unknown): string[] => {
      if (!value) { return []; }
      try {
        const p: unknown = JSON.parse(value as string);
        return Array.isArray(p) ? p.filter((i: unknown): i is string => typeof i === "string") : [];
      } catch {
        return [];
      }
    },
    slugify: (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40),
    encrypt: vi.fn((x: unknown) => x),
    decrypt: vi.fn((x: unknown) => x),
  };
}
