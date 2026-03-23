/**
 * Unit tests for the orchestrator context data-fetching helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@grackle-ai/database", () => ({
  db: {},
  sqlite: undefined,
  openDatabase: vi.fn(),
  initDatabase: vi.fn(),
  schema: {},
  taskStore: {
    listTasks: vi.fn(() => []),
    getTask: vi.fn(),
    buildChildIdsMap: vi.fn(() => new Map()),
    getChildren: vi.fn(() => []),
    createTask: vi.fn(),
    areDependenciesMet: vi.fn(() => true),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    checkAndUnblock: vi.fn(() => []),
    markTaskComplete: vi.fn(),
  },
  personaStore: {
    listPersonas: vi.fn(() => []),
    getPersona: vi.fn(),
  },
  envRegistry: {
    listEnvironments: vi.fn(() => []),
    getEnvironment: vi.fn(),
    addEnvironment: vi.fn(),
    removeEnvironment: vi.fn(),
    updateEnvironmentStatus: vi.fn(),
    markBootstrapped: vi.fn(),
  },
  workspaceStore: {
    getWorkspace: vi.fn(() => undefined),
    listWorkspaces: vi.fn(() => []),
    createWorkspace: vi.fn(),
    archiveWorkspace: vi.fn(),
    countWorkspacesByEnvironment: vi.fn(() => 0),
  },
  findingStore: {
    queryFindings: vi.fn(() => []),
    postFinding: vi.fn(),
  },
  tokenStore: {
    listTokens: vi.fn(() => []),
    setToken: vi.fn(),
    deleteToken: vi.fn(),
  },
  sessionStore: {
    createSession: vi.fn(),
    getSession: vi.fn(() => undefined),
    listSessions: vi.fn(() => []),
    listSessionsForTask: vi.fn(() => []),
    listSessionsByTaskIds: vi.fn(() => []),
    getLatestSessionForTask: vi.fn(() => undefined),
    getActiveSessionsForTask: vi.fn(() => []),
    updateSession: vi.fn(),
    deleteByEnvironment: vi.fn(),
    setSessionTask: vi.fn(),
  },
  settingsStore: {
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    isAllowedSettingKey: vi.fn(() => true),
    WRITABLE_SETTING_KEYS: new Set(["default_persona_id", "onboarding_completed"]),
  },
  isAllowedSettingKey: vi.fn(() => true),
  WRITABLE_SETTING_KEYS: new Set(["default_persona_id", "onboarding_completed"]),
  credentialProviders: {
    getCredentialProviders: vi.fn(() => ({ claude: "off", github: "off", copilot: "off", codex: "off", goose: "off" })),
    setCredentialProviders: vi.fn(),
    isValidCredentialProviderConfig: vi.fn(() => true),
    VALID_PROVIDERS: ["claude", "github", "copilot", "codex", "goose"],
    VALID_CLAUDE_VALUES: new Set(["off", "subscription", "api_key"]),
    VALID_TOGGLE_VALUES: new Set(["off", "on"]),
    parseCredentialProviderConfig: vi.fn(),
  },
  grackleHome: "/tmp/test-grackle",
  safeParseJsonArray: (value: unknown) => { if (!value) return []; try { const p = JSON.parse(value as string); return Array.isArray(p) ? p.filter((i: unknown) => typeof i === "string") : []; } catch { return []; } },
  slugify: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40),
  encrypt: vi.fn((x: unknown) => x),
  decrypt: vi.fn((x: unknown) => x),
  persistEvent: vi.fn(),
  seedDatabase: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { fetchOrchestratorContext } from "./orchestrator-context.js";
import { taskStore, personaStore, envRegistry, workspaceStore, findingStore } from "@grackle-ai/database";

describe("fetchOrchestratorContext", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-establish default return values after reset
    vi.mocked(taskStore.listTasks).mockReturnValue([]);
    vi.mocked(personaStore.listPersonas).mockReturnValue([]);
    vi.mocked(envRegistry.listEnvironments).mockReturnValue([]);
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(undefined);
    vi.mocked(findingStore.queryFindings).mockReturnValue([]);
  });

  it("returns workspace metadata when workspace exists", () => {
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue({
      id: "ws-1",
      name: "My Project",
      description: "A cool project",
      repoUrl: "https://github.com/test/repo",
      environmentId: "env-1",
      status: "active",
      useWorktrees: true,
      worktreeBasePath: "",
      defaultPersonaId: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });

    const result = fetchOrchestratorContext("ws-1");

    expect(result.workspace).toEqual({
      name: "My Project",
      description: "A cool project",
      repoUrl: "https://github.com/test/repo",
    });
  });

  it("returns undefined workspace when not found", () => {
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(undefined);

    const result = fetchOrchestratorContext("ws-missing");

    expect(result.workspace).toBeUndefined();
  });

  it("maps tasks to TaskTreeNode with resolved persona names", () => {
    vi.mocked(personaStore.listPersonas).mockReturnValue([
      { id: "eng", name: "Engineer", description: "Writes code", systemPrompt: "", toolConfig: "{}", runtime: "claude-code", model: "", maxTurns: 0, mcpServers: "[]", type: "agent", script: "", createdAt: "", updatedAt: "" },
    ]);
    vi.mocked(taskStore.listTasks).mockReturnValue([
      { id: "t1", title: "Task 1", description: "", status: "working", branch: "feat-1", dependsOn: '["t0"]', startedAt: null, completedAt: null, createdAt: "", updatedAt: "", sortOrder: 0, parentTaskId: "", depth: 0, canDecompose: true, defaultPersonaId: "eng", workspaceId: "ws-1" },
    ]);

    const result = fetchOrchestratorContext("ws-1");

    expect(result.taskTree).toHaveLength(1);
    expect(result.taskTree[0].title).toBe("Task 1");
    expect(result.taskTree[0].personaName).toBe("Engineer");
    expect(result.taskTree[0].dependsOn).toEqual(["t0"]);
    expect(result.taskTree[0].status).toBe("working");
  });

  it("returns all personas as PersonaSummary", () => {
    vi.mocked(personaStore.listPersonas).mockReturnValue([
      { id: "eng", name: "Engineer", description: "Writes code", systemPrompt: "", toolConfig: "{}", runtime: "claude-code", model: "", maxTurns: 0, mcpServers: "[]", type: "agent", script: "", createdAt: "", updatedAt: "" },
      { id: "rev", name: "Reviewer", description: "Reviews PRs", systemPrompt: "", toolConfig: "{}", runtime: "copilot", model: "", maxTurns: 0, mcpServers: "[]", type: "agent", script: "", createdAt: "", updatedAt: "" },
    ]);

    const result = fetchOrchestratorContext("ws-1");

    expect(result.availablePersonas).toEqual([
      { name: "Engineer", description: "Writes code", runtime: "claude-code", model: "" },
      { name: "Reviewer", description: "Reviews PRs", runtime: "copilot", model: "" },
    ]);
  });

  it("returns all environments as EnvironmentSummary", () => {
    vi.mocked(envRegistry.listEnvironments).mockReturnValue([
      { id: "env-1", displayName: "Local Dev", adapterType: "local", adapterConfig: "{}", defaultRuntime: "claude-code", bootstrapped: true, status: "connected", lastSeen: null, envInfo: null, createdAt: "", powerlineToken: "" },
      { id: "env-2", displayName: "SSH Box", adapterType: "ssh", adapterConfig: "{}", defaultRuntime: "claude-code", bootstrapped: false, status: "disconnected", lastSeen: null, envInfo: null, createdAt: "", powerlineToken: "" },
    ]);

    const result = fetchOrchestratorContext("ws-1");

    expect(result.availableEnvironments).toEqual([
      { displayName: "Local Dev", adapterType: "local", status: "connected", defaultRuntime: "claude-code" },
      { displayName: "SSH Box", adapterType: "ssh", status: "disconnected", defaultRuntime: "claude-code" },
    ]);
  });

  it("returns findings context string", () => {
    vi.mocked(findingStore.queryFindings).mockReturnValue([
      { id: "f1", workspaceId: "ws-1", taskId: "t1", sessionId: "s1", category: "decision", title: "Used React", content: "Chose React for the frontend.", tags: "[]", createdAt: "2026-01-01" },
    ]);

    const result = fetchOrchestratorContext("ws-1");

    expect(result.findingsContext).toContain("## Workspace Findings");
    expect(result.findingsContext).toContain("[decision] Used React");
    expect(result.findingsContext).toContain("Chose React for the frontend.");
    expect(findingStore.queryFindings).toHaveBeenCalledWith("ws-1", undefined, undefined, 20);
  });

  it("handles empty stores gracefully", () => {
    const result = fetchOrchestratorContext("ws-1");

    expect(result.taskTree).toEqual([]);
    expect(result.availablePersonas).toEqual([]);
    expect(result.availableEnvironments).toEqual([]);
    expect(result.findingsContext).toBe("");
    expect(result.workspace).toBeUndefined();
  });

  it("resolves persona name to empty string when persona not found", () => {
    vi.mocked(personaStore.listPersonas).mockReturnValue([]);
    vi.mocked(taskStore.listTasks).mockReturnValue([
      { id: "t1", title: "Task 1", description: "", status: "not_started", branch: "", dependsOn: "[]", startedAt: null, completedAt: null, createdAt: "", updatedAt: "", sortOrder: 0, parentTaskId: "", depth: 0, canDecompose: false, defaultPersonaId: "unknown-persona", workspaceId: "ws-1" },
    ]);

    const result = fetchOrchestratorContext("ws-1");

    expect(result.taskTree[0].personaName).toBe("");
  });
});
