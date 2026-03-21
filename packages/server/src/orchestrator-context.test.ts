/**
 * Unit tests for the orchestrator context data-fetching helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./task-store.js", () => ({
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
}));

vi.mock("./persona-store.js", () => ({
  listPersonas: vi.fn(() => []),
  getPersona: vi.fn(),
}));

vi.mock("./env-registry.js", () => ({
  listEnvironments: vi.fn(() => []),
  getEnvironment: vi.fn(),
  addEnvironment: vi.fn(),
  removeEnvironment: vi.fn(),
  updateEnvironmentStatus: vi.fn(),
  markBootstrapped: vi.fn(),
}));

vi.mock("./workspace-store.js", () => ({
  getWorkspace: vi.fn(() => undefined),
  listWorkspaces: vi.fn(() => []),
  createWorkspace: vi.fn(),
  archiveWorkspace: vi.fn(),
  countWorkspacesByEnvironment: vi.fn(() => 0),
}));

vi.mock("./finding-store.js", () => ({
  buildFindingsContext: vi.fn(() => ""),
  queryFindings: vi.fn(() => []),
  postFinding: vi.fn(),
}));

import { fetchOrchestratorContext } from "./orchestrator-context.js";
import * as taskStore from "./task-store.js";
import * as personaStore from "./persona-store.js";
import * as envRegistry from "./env-registry.js";
import * as workspaceStore from "./workspace-store.js";
import * as findingStore from "./finding-store.js";

describe("fetchOrchestratorContext", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-establish default return values after reset
    vi.mocked(taskStore.listTasks).mockReturnValue([]);
    vi.mocked(personaStore.listPersonas).mockReturnValue([]);
    vi.mocked(envRegistry.listEnvironments).mockReturnValue([]);
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(undefined);
    vi.mocked(findingStore.buildFindingsContext).mockReturnValue("");
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
      { name: "Engineer", description: "Writes code", runtime: "claude-code" },
      { name: "Reviewer", description: "Reviews PRs", runtime: "copilot" },
    ]);
  });

  it("returns all environments as EnvironmentSummary", () => {
    vi.mocked(envRegistry.listEnvironments).mockReturnValue([
      { id: "env-1", displayName: "Local Dev", adapterType: "local", adapterConfig: "{}", defaultRuntime: "claude-code", bootstrapped: true, status: "connected", lastSeen: null, envInfo: null, createdAt: "", powerlineToken: "" },
      { id: "env-2", displayName: "SSH Box", adapterType: "ssh", adapterConfig: "{}", defaultRuntime: "claude-code", bootstrapped: false, status: "disconnected", lastSeen: null, envInfo: null, createdAt: "", powerlineToken: "" },
    ]);

    const result = fetchOrchestratorContext("ws-1");

    expect(result.availableEnvironments).toEqual([
      { displayName: "Local Dev", adapterType: "local", status: "connected" },
      { displayName: "SSH Box", adapterType: "ssh", status: "disconnected" },
    ]);
  });

  it("returns findings context string", () => {
    vi.mocked(findingStore.buildFindingsContext).mockReturnValue("## Workspace Findings\n\nSome findings here.");

    const result = fetchOrchestratorContext("ws-1");

    expect(result.findingsContext).toBe("## Workspace Findings\n\nSome findings here.");
    expect(findingStore.buildFindingsContext).toHaveBeenCalledWith("ws-1");
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
