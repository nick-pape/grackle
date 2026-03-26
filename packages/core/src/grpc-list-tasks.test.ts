/**
 * Integration tests for the gRPC listTasks handler.
 * Verifies the handler→store→response chain including search and status filters.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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

vi.mock("./ws-broadcast.js", () => ({
  broadcast: vi.fn(),
  setWssInstance: vi.fn(),
  broadcastEnvironments: vi.fn(),
  envRowToWs: vi.fn(),
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

import { registerGrackleRoutes } from "./grpc-service.js";
import { sqlite as _sqlite, workspaceStore, taskStore, sessionStore } from "@grackle-ai/database";
const sqlite = _sqlite!;
import { computeTaskStatus } from "./compute-task-status.js";
import { grackle } from "@grackle-ai/common";
import type { ConnectRouter } from "@connectrpc/connect";

/** Apply schema DDL to in-memory database. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      repo_url      TEXT NOT NULL DEFAULT '',
      environment_id TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'active',
      use_worktrees INTEGER NOT NULL DEFAULT 1,
      working_directory TEXT NOT NULL DEFAULT '',
      default_persona_id TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT REFERENCES workspaces(id),
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'not_started',
      branch        TEXT NOT NULL DEFAULT '',
      depends_on    TEXT NOT NULL DEFAULT '[]',
      assigned_at   TEXT,
      started_at    TEXT,
      completed_at  TEXT,
      review_notes  TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      sort_order    INTEGER NOT NULL DEFAULT 0,
      parent_task_id TEXT NOT NULL DEFAULT '',
      depth         INTEGER NOT NULL DEFAULT 0,
      can_decompose INTEGER NOT NULL DEFAULT 0,
      default_persona_id TEXT NOT NULL DEFAULT '',
      workpad   TEXT NOT NULL DEFAULT '',
      schedule_id TEXT NOT NULL DEFAULT ''
    );
  `);
}

/** Extract service handlers via fake router. */
function getHandlers(): Record<string, (...args: unknown[]) => unknown> {
  let handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const fakeRouter = {
    service(_def: unknown, impl: Record<string, (...args: unknown[]) => unknown>) {
      handlers = impl;
    },
  } as unknown as ConnectRouter;
  registerGrackleRoutes(fakeRouter);
  return handlers;
}

describe("gRPC listTasks handler", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;
  const WORKSPACE_ID = "test-proj";

  beforeEach(() => {
    vi.clearAllMocks();
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    applySchema();

    // Seed workspace and tasks using real stores
    workspaceStore.createWorkspace(WORKSPACE_ID, "Test Project", "desc", "", "");
    taskStore.createTask("t1", WORKSPACE_ID, "Fix login bug", "User cannot login with SSO", [], "test-workspace");
    taskStore.createTask("t2", WORKSPACE_ID, "Add dashboard", "Create analytics dashboard", [], "test-workspace");
    taskStore.createTask("t3", WORKSPACE_ID, "Update auth middleware", "Refactor authentication layer", [], "test-workspace");
    taskStore.updateTaskStatus("t2", "working");
    taskStore.updateTaskStatus("t3", "complete");

    // Default: no sessions
    vi.mocked(sessionStore.listSessionsByTaskIds).mockReturnValue([]);
    // Default: passthrough stored status
    vi.mocked(computeTaskStatus).mockImplementation((storedStatus: string) => ({
      status: storedStatus,
      latestSessionId: "",
    }));

    handlers = getHandlers();
  });

  it("filters by exact search term", async () => {
    const result = await handlers.listTasks({
      workspaceId: WORKSPACE_ID,
      search: "login",
      status: "",
    }) as grackle.TaskList;

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("Fix login bug");
  });

  it("fuzzy matches typos (e.g. 'logn bug' matches 'Fix login bug')", async () => {
    const result = await handlers.listTasks({
      workspaceId: WORKSPACE_ID,
      search: "logn bug",
      status: "",
    }) as grackle.TaskList;

    expect(result.tasks.length).toBeGreaterThanOrEqual(1);
    expect(result.tasks[0].title).toBe("Fix login bug");
  });

  it("ranks title matches higher than description-only matches", async () => {
    // "auth" appears in title of "Update auth middleware" and description of task with "authentication"
    const result = await handlers.listTasks({
      workspaceId: WORKSPACE_ID,
      search: "auth",
      status: "",
    }) as grackle.TaskList;

    expect(result.tasks.length).toBeGreaterThanOrEqual(1);
    expect(result.tasks[0].title).toBe("Update auth middleware");
  });

  it("filters by status", async () => {
    const result = await handlers.listTasks({
      workspaceId: WORKSPACE_ID,
      search: "",
      status: "working",
    }) as grackle.TaskList;

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("Add dashboard");
  });

  it("returns all tasks when no filters", async () => {
    const result = await handlers.listTasks({
      workspaceId: WORKSPACE_ID,
      search: "",
      status: "",
    }) as grackle.TaskList;

    expect(result.tasks).toHaveLength(3);
  });

  it("combines search and status filters", async () => {
    const result = await handlers.listTasks({
      workspaceId: WORKSPACE_ID,
      search: "auth",
      status: "complete",
    }) as grackle.TaskList;

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe("Update auth middleware");
  });

  it("returns empty for search with no matches", async () => {
    const result = await handlers.listTasks({
      workspaceId: WORKSPACE_ID,
      search: "xyznonexistent",
      status: "",
    }) as grackle.TaskList;

    expect(result.tasks).toHaveLength(0);
  });

  it("returns tasks with computed status, childTaskIds, and latestSessionId", async () => {
    // Create a parent with children
    taskStore.createTask("tp", WORKSPACE_ID, "Parent task", "desc", [], "test-workspace", "", true);
    taskStore.createTask("tc1", WORKSPACE_ID, "Child 1", "desc", [], "test-workspace", "tp");
    taskStore.createTask("tc2", WORKSPACE_ID, "Child 2", "desc", [], "test-workspace", "tp");

    // Mock sessions for the parent task
    vi.mocked(sessionStore.listSessionsByTaskIds).mockReturnValue([
      { id: "sess-1", taskId: "tp", status: "running", startedAt: "2025-01-01T00:00:00" } as never,
    ]);
    vi.mocked(computeTaskStatus).mockImplementation((storedStatus: string, sessions: unknown[]) => {
      if (sessions && sessions.length > 0) {
        return { status: "working", latestSessionId: "sess-1" };
      }
      return { status: storedStatus, latestSessionId: "" };
    });

    const result = await handlers.listTasks({
      workspaceId: WORKSPACE_ID,
      search: "",
      status: "",
    }) as grackle.TaskList;

    const parent = result.tasks.find((t) => t.id === "tp");
    expect(parent).toBeDefined();
    expect(parent!.childTaskIds).toContain("tc1");
    expect(parent!.childTaskIds).toContain("tc2");
    expect(parent!.latestSessionId).toBe("sess-1");
  });
});
