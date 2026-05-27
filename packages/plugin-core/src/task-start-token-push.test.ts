/**
 * Unit tests verifying that credentials are authenticated (on demand) before
 * each task spawn (AHP HR6), and that the deprecated proactive PushTokens path
 * is never used.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock heavy dependencies before importing modules under test ─────

vi.mock("@grackle-ai/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@grackle-ai/database")>();
  actual.openDatabase(":memory:");
  actual.initDatabase();
  return {
    ...actual,
    envRegistry: {
      listEnvironments: vi.fn(() => []),
      getEnvironment: vi.fn(() => ({ adapterType: "local" })),
      addEnvironment: vi.fn(),
      removeEnvironment: vi.fn(),
      updateEnvironmentStatus: vi.fn(),
      markBootstrapped: vi.fn(),
    },
    workspaceStore: {
      listWorkspaces: vi.fn(() => []),
      getWorkspace: vi.fn(() => ({
        id: "proj-1",
        name: "Test Workspace",
        environmentId: "env-1",
        status: "active",
        createdAt: new Date().toISOString(),
      })),
      createWorkspace: vi.fn(),
      archiveWorkspace: vi.fn(),
      countWorkspacesByEnvironment: vi.fn(() => 0),
    },
    taskStore: {
      listTasks: vi.fn(() => []),
      buildChildIdsMap: vi.fn(() => new Map()),
      getTask: vi.fn(() => undefined),
      createTask: vi.fn(),
      markTaskComplete: vi.fn(),
      checkAndUnblock: vi.fn(() => []),
      areDependenciesMet: vi.fn(() => true),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      getChildren: vi.fn(() => []),
    },
    personaStore: {
      listPersonas: vi.fn(() => []),
      getPersona: vi.fn(() => ({
        id: "claude-code",
        name: "Claude Code",
        runtime: "claude-code",
        model: "sonnet",
        maxTurns: 0,
        systemPrompt: "",
        toolConfig: "{}",
        mcpServers: "[]",
      })),
      getPersonaByName: vi.fn(() => undefined),
      createPersona: vi.fn(),
      updatePersona: vi.fn(),
      deletePersona: vi.fn(),
    },
    settingsStore: {
      getSetting: vi.fn((key: string) =>
        key === "default_persona_id" ? "claude-code" : undefined,
      ),
      setSetting: vi.fn(),
    },
    credentialProviders: {
      getCredentialProviders: vi.fn(() => ({
        claude: "off",
        github: "off",
        copilot: "off",
        codex: "off",
        goose: "off",
      })),
      setCredentialProviders: vi.fn(),
    },
  };
});

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logWriter: {
      initLog: vi.fn(),
      writeEvent: vi.fn(),
      endSession: vi.fn(),
      readLog: vi.fn(() => []),
    },
    streamHub: {
      publish: vi.fn(),
      createStream: vi.fn(() => {
        const iter = (async function* () {})();
        return Object.assign(iter, { cancel: vi.fn() });
      }),
      createGlobalStream: vi.fn(() => {
        const iter = (async function* () {})();
        return Object.assign(iter, { cancel: vi.fn() });
      }),
    },
    emit: vi.fn(),
    processEventStream: vi.fn(),
    tokenPush: {
      authenticateForRuntime: vi.fn().mockResolvedValue(undefined),
    },
    adapterManager: {
      getAdapter: vi.fn(),
      getConnection: vi.fn(() => undefined),
      setConnection: vi.fn(),
      removeConnection: vi.fn(),
      registerAdapter: vi.fn(),
      startHeartbeat: vi.fn(),
    },
  };
});

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  reconnectOrProvision: vi.fn(async function* () {}),
}));

vi.mock("@grackle-ai/prompt", () => ({
  SystemPromptBuilder: vi.fn().mockImplementation(() => ({ build: () => "" })),
  buildTaskPrompt: vi.fn((title: string) => title),
  resolvePersona: vi.fn(() => ({
    personaId: "p1",
    runtime: "claude-code",
    model: "sonnet",
    maxTurns: 0,
    systemPrompt: "",
    toolConfig: "{}",
    mcpServers: "[]",
    type: "agent",
    script: "",
  })),
  buildOrchestratorContext: vi.fn(() => undefined),
}));

vi.mock("./utils/slugify.js", () => ({
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-")),
}));

vi.mock("./utils/exec.js", () => ({
  exec: vi.fn(),
}));

const { mockBuildProviderTokenBundle } = vi.hoisted(() => ({
  mockBuildProviderTokenBundle: vi.fn(),
}));

vi.mock("./credential-bundle.js", () => ({
  buildProviderTokenBundle: mockBuildProviderTokenBundle,
}));

// Import AFTER mocks
import { sqlite as _sqlite, taskStore } from "@grackle-ai/database";
const sqlite = _sqlite!;
import { tokenPush as tokenBroker, adapterManager } from "@grackle-ai/core";

/** Apply the minimal SQLite schema needed for tests. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id                 TEXT PRIMARY KEY,
      env_id             TEXT NOT NULL DEFAULT '',
      runtime            TEXT NOT NULL DEFAULT '',
      runtime_session_id TEXT,
      prompt             TEXT NOT NULL DEFAULT '',
      model              TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'pending',
      log_path           TEXT,
      turns              INTEGER NOT NULL DEFAULT 0,
      started_at         TEXT NOT NULL DEFAULT (datetime('now')),
      suspended_at       TEXT,
      ended_at           TEXT,
      error              TEXT,
      task_id            TEXT NOT NULL DEFAULT '',
      persona_id         TEXT NOT NULL DEFAULT '',
      parent_session_id  TEXT NOT NULL DEFAULT '',
      pipe_mode          TEXT NOT NULL DEFAULT '',
      input_tokens       INTEGER NOT NULL DEFAULT 0,
      output_tokens      INTEGER NOT NULL DEFAULT 0,
      cost_millicents    INTEGER NOT NULL DEFAULT 0,
      end_reason         TEXT,
      sigterm_sent_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id     TEXT PRIMARY KEY,
      config TEXT NOT NULL DEFAULT '{}'
    );
  `);
}

/** Build a mock PowerLineConnection with a spawn method and pushTokens. */
function makeMockConnection() {
  const spawnStream = (async function* () {})();
  return {
    client: {
      spawn: vi.fn(() => spawnStream),
      authenticate: vi.fn().mockResolvedValue({}),
      pushTokens: vi.fn().mockResolvedValue({}),
      sendInput: vi.fn().mockResolvedValue({}),
    },
    environmentId: "env-1",
    port: 7433,
  };
}

/** Create a mock task row matching TaskRow shape. */
function makeMockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    workspaceId: "proj-1",
    title: "Test task",
    description: "A test",
    status: "not_started",
    branch: "",
    canDecompose: false,
    parentId: "",
    depth: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("task-start token push", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS tokens");
    applySchema();
    vi.clearAllMocks();
  });

  describe("grpc-service startTask()", () => {
    it("authenticates the runtime before spawn, and never uses the deprecated PushTokens", async () => {
      const { registerGrackleRoutes } = await import("./grpc-service.js");

      const mockConn = makeMockConnection();
      vi.spyOn(adapterManager, "getConnection").mockReturnValue(
        mockConn as unknown as ReturnType<typeof adapterManager.getConnection>,
      );

      const authSpy = vi.spyOn(tokenBroker, "authenticateForRuntime").mockResolvedValue();

      vi.mocked(taskStore.getTask).mockReturnValue(
        makeMockTask() as ReturnType<typeof taskStore.getTask>,
      );
      vi.mocked(taskStore.areDependenciesMet).mockReturnValue(true);

      const handlers = new Map<string, Function>();
      const fakeRouter = {
        service: (_svc: unknown, impl: Record<string, Function>) => {
          for (const [name, fn] of Object.entries(impl)) {
            handlers.set(name, fn);
          }
        },
      };
      registerGrackleRoutes(fakeRouter as never);

      const startTask = handlers.get("startTask");
      expect(startTask).toBeDefined();

      await startTask!({ taskId: "task-1", environmentId: "env-1" });

      // Demand-driven authenticate is used, scoped to the runtime.
      expect(authSpy).toHaveBeenCalledWith("env-1", "claude-code", { excludeFileTokens: true });
      // Cutover proof: the deprecated proactive push is never called.
      expect(mockConn.client.pushTokens).not.toHaveBeenCalled();

      // Authenticate happens before spawn.
      const authOrder = authSpy.mock.invocationCallOrder[0];
      const spawnOrder = mockConn.client.spawn.mock.invocationCallOrder[0];
      expect(authOrder).toBeLessThan(spawnOrder);
    });
  });
});
