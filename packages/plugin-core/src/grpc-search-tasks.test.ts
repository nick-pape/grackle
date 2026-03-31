/**
 * Integration tests for the gRPC searchTasks handler.
 * Verifies fuzzy matching, relevance scoring, limit, status filter, and error handling.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError } from "@connectrpc/connect";

// ── Mock heavy dependencies before importing the module ──────────

vi.mock("@grackle-ai/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@grackle-ai/database")>();
  actual.openDatabase(":memory:");
  actual.initDatabase();
  return {
    ...actual,
    tokenStore: {
      listTokens: vi.fn(() => []),
      setToken: vi.fn(),
      deleteToken: vi.fn(),
    },
    envRegistry: {
      listEnvironments: vi.fn(() => []),
      getEnvironment: vi.fn(),
      addEnvironment: vi.fn(),
      removeEnvironment: vi.fn(),
      updateEnvironmentStatus: vi.fn(),
      markBootstrapped: vi.fn(),
      resetAllStatuses: vi.fn(),
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
    findingStore: {
      queryFindings: vi.fn(() => []),
      postFinding: vi.fn(),
    },
    personaStore: {
      listPersonas: vi.fn(() => []),
      getPersona: vi.fn(() => undefined),
      getPersonaByName: vi.fn(() => undefined),
      createPersona: vi.fn(),
      updatePersona: vi.fn(),
      deletePersona: vi.fn(),
    },
  };
});

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./log-writer.js", () => ({
  initLog: vi.fn(),
  writeEvent: vi.fn(),
  endSession: vi.fn(),
  readLog: vi.fn(() => []),
}));

vi.mock("./stream-hub.js", () => ({
  publish: vi.fn(),
  createStream: vi.fn(() => {
    const iter = (async function* () {})();
    return Object.assign(iter, { cancel: vi.fn() });
  }),
  createGlobalStream: vi.fn(() => {
    const iter = (async function* () {})();
    return Object.assign(iter, { cancel: vi.fn() });
  }),
}));

vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

vi.mock("./token-push.js", () => ({
  pushToEnv: vi.fn(),
  pushProviderCredentialsToEnv: vi.fn(),
  refreshTokensForTask: vi.fn(),
}));

vi.mock("./adapter-manager.js", () => ({
  getAdapter: vi.fn(),
  getConnection: vi.fn(() => undefined),
  setConnection: vi.fn(),
  removeConnection: vi.fn(),
  registerAdapter: vi.fn(),
  startHeartbeat: vi.fn(),
}));

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  reconnectOrProvision: vi.fn(async function* () {}),
}));

vi.mock("@grackle-ai/prompt", () => ({
  SystemPromptBuilder: vi.fn().mockImplementation(() => ({ build: () => "" })),
  buildTaskPrompt: vi.fn((title: string) => title),
}));

vi.mock("./utils/slugify.js", () => ({
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-")),
}));

vi.mock("./event-processor.js", () => ({
  processEventStream: vi.fn(),
}));

vi.mock("./processor-registry.js", () => ({
  get: vi.fn(() => undefined),
  lateBind: vi.fn(),
}));

vi.mock("./compute-task-status.js", () => ({
  computeTaskStatus: vi.fn((storedStatus: string) => ({
    status: storedStatus,
    latestSessionId: "",
  })),
}));

// ── Import AFTER mocks ──────────────────────────────────────────

import { workspaceStore, taskStore, sessionStore } from "@grackle-ai/database";
import { computeTaskStatus } from "./compute-task-status.js";
import { grackle } from "@grackle-ai/common";
import { resetSchema, getHandlers } from "./grpc-task-test-helpers.js";

describe("gRPC searchTasks handler", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;
  const WORKSPACE_ID = "ws-search-test";

  beforeEach(() => {
    vi.clearAllMocks();
    resetSchema();

    workspaceStore.createWorkspace(WORKSPACE_ID, "Search Test Workspace", "desc", "", "");
    // Tasks with varied titles and descriptions for fuzzy matching
    taskStore.createTask("t1", WORKSPACE_ID, "Fix login authentication bug", "User cannot login with SSO provider", [], "");
    taskStore.createTask("t2", WORKSPACE_ID, "Add analytics dashboard", "Create charts for user activity", [], "");
    taskStore.createTask("t3", WORKSPACE_ID, "Update payment processing", "Integrate Stripe for subscriptions", [], "");
    taskStore.createTask("t4", WORKSPACE_ID, "Refactor database layer", "Login info stored in auth module", [], "");
    taskStore.updateTaskStatus("t3", "working");
    taskStore.updateTaskStatus("t4", "complete");

    vi.mocked(sessionStore.listSessionsByTaskIds).mockReturnValue([]);
    vi.mocked(computeTaskStatus).mockImplementation((storedStatus: string) => ({
      status: storedStatus,
      latestSessionId: "",
    }));

    handlers = getHandlers();
  });

  it("throws InvalidArgument for empty query", async () => {
    await expect(
      handlers.searchTasks({ query: "", workspaceId: WORKSPACE_ID, limit: 0, status: "" }),
    ).rejects.toThrow(ConnectError);

    await expect(
      handlers.searchTasks({ query: "   ", workspaceId: WORKSPACE_ID, limit: 0, status: "" }),
    ).rejects.toThrow(ConnectError);
  });

  it("returns results for an exact title match with high relevance", async () => {
    const result = await handlers.searchTasks({
      query: "Fix login authentication bug",
      workspaceId: WORKSPACE_ID,
      limit: 0,
      status: "",
    }) as grackle.SearchTasksResponse;

    expect(result.results.length).toBeGreaterThan(0);
    const top = result.results[0];
    expect(top.task!.title).toBe("Fix login authentication bug");
    expect(top.relevanceScore).toBeGreaterThan(0.9);
  });

  it("returns results for a partial query (fuzzy match)", async () => {
    const result = await handlers.searchTasks({
      query: "login bug",
      workspaceId: WORKSPACE_ID,
      limit: 0,
      status: "",
    }) as grackle.SearchTasksResponse;

    expect(result.results.length).toBeGreaterThan(0);
    const titles = result.results.map((r) => r.task!.title);
    expect(titles).toContain("Fix login authentication bug");
  });

  it("returns results sorted by relevance (best match first)", async () => {
    const result = await handlers.searchTasks({
      query: "login",
      workspaceId: WORKSPACE_ID,
      limit: 10,
      status: "",
    }) as grackle.SearchTasksResponse;

    expect(result.results.length).toBeGreaterThan(0);
    for (let i = 1; i < result.results.length; i++) {
      expect(result.results[i - 1].relevanceScore).toBeGreaterThanOrEqual(result.results[i].relevanceScore);
    }
  });

  it("limits results to the specified limit", async () => {
    // Seed enough tasks to exceed the limit
    for (let i = 5; i <= 15; i++) {
      taskStore.createTask(`t${i}`, WORKSPACE_ID, `Login related task ${i}`, "login auth description", [], "");
    }

    const result = await handlers.searchTasks({
      query: "login",
      workspaceId: WORKSPACE_ID,
      limit: 3,
      status: "",
    }) as grackle.SearchTasksResponse;

    expect(result.results.length).toBeLessThanOrEqual(3);
  });

  it("defaults to limit 10 when limit is 0", async () => {
    for (let i = 5; i <= 20; i++) {
      taskStore.createTask(`tlim${i}`, WORKSPACE_ID, `Login task ${i}`, "login auth description", [], "");
    }

    const result = await handlers.searchTasks({
      query: "login",
      workspaceId: WORKSPACE_ID,
      limit: 0,
      status: "",
    }) as grackle.SearchTasksResponse;

    expect(result.results.length).toBeLessThanOrEqual(10);
  });

  it("filters by status before fuzzy matching", async () => {
    const result = await handlers.searchTasks({
      query: "login",
      workspaceId: WORKSPACE_ID,
      limit: 0,
      status: "complete",
    }) as grackle.SearchTasksResponse;

    // Only t4 has status=complete and contains "login" in its description
    const titles = result.results.map((r) => r.task!.title);
    expect(titles).toContain("Refactor database layer");
    // t1 (not_started) should not appear because status filter is "complete"
    expect(titles).not.toContain("Fix login authentication bug");
  });

  it("returns empty results for a completely unrelated query", async () => {
    const result = await handlers.searchTasks({
      query: "xqzjkwp",
      workspaceId: WORKSPACE_ID,
      limit: 0,
      status: "",
    }) as grackle.SearchTasksResponse;

    expect(result.results).toHaveLength(0);
  });

  it("includes relevance scores between 0 and 1", async () => {
    const result = await handlers.searchTasks({
      query: "dashboard",
      workspaceId: WORKSPACE_ID,
      limit: 0,
      status: "",
    }) as grackle.SearchTasksResponse;

    expect(result.results.length).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(r.relevanceScore).toBeLessThanOrEqual(1);
    }
  });

  it("includes childTaskIds and latestSessionId in results", async () => {
    taskStore.createTask("parent", WORKSPACE_ID, "Parent login task", "desc", [], "", "", true);
    taskStore.createTask("child1", WORKSPACE_ID, "Child 1", "desc", [], "", "parent");

    vi.mocked(sessionStore.listSessionsByTaskIds).mockReturnValue([
      { id: "sess-1", taskId: "parent", status: "running", startedAt: "2025-01-01T00:00:00" } as never,
    ]);
    vi.mocked(computeTaskStatus).mockImplementation((storedStatus: string, sessions: unknown[]) => {
      if (sessions && sessions.length > 0) {
        return { status: "working", latestSessionId: "sess-1" };
      }
      return { status: storedStatus, latestSessionId: "" };
    });

    const result = await handlers.searchTasks({
      query: "Parent login task",
      workspaceId: WORKSPACE_ID,
      limit: 0,
      status: "",
    }) as grackle.SearchTasksResponse;

    const parentResult = result.results.find((r) => r.task!.id === "parent");
    expect(parentResult).toBeDefined();
    expect(parentResult!.task!.childTaskIds).toContain("child1");
    expect(parentResult!.task!.latestSessionId).toBe("sess-1");
  });
});
