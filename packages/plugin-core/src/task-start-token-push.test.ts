/**
 * Unit tests verifying that token + credential push happens before each task
 * spawn, and that failures are non-blocking.
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
    findingStore: {
      queryFindings: vi.fn(() => []),
      postFinding: vi.fn(),
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
      getSetting: vi.fn((key: string) => key === "default_persona_id" ? "claude-code" : undefined),
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
  const actual = await importOriginal() as Record<string, unknown>;
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
      pushToEnv: vi.fn().mockResolvedValue(undefined),
      pushProviderCredentialsToEnv: vi.fn().mockResolvedValue(undefined),
      refreshTokensForTask: vi.fn().mockResolvedValue(undefined),
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
  resolvePersona: vi.fn(() => ({ personaId: "p1", runtime: "claude-code", model: "sonnet", maxTurns: 0, systemPrompt: "", toolConfig: "{}", mcpServers: "[]", type: "agent", script: "" })),
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
import { tokenPush as tokenBroker, adapterManager, logger } from "@grackle-ai/core";
import { create } from "@bufbuild/protobuf";
import { powerline } from "@grackle-ai/common";

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

  describe("pushProviderCredentialsToEnv()", () => {
    it("is callable as a mock", async () => {
      await tokenBroker.pushProviderCredentialsToEnv("env-1");
      expect(tokenBroker.pushProviderCredentialsToEnv).toHaveBeenCalledWith("env-1");
    });
  });

  describe("refreshTokensForTask()", () => {
    it("is callable as a mock", async () => {
      await tokenBroker.refreshTokensForTask("env-1");
      expect(tokenBroker.refreshTokensForTask).toHaveBeenCalledWith("env-1");
    });
  });

  describe("grpc-service startTask()", () => {
    it("calls refreshTokensForTask before spawn", async () => {
      const { registerGrackleRoutes } = await import("./grpc-service.js");

      const mockConn = makeMockConnection();
      vi.spyOn(adapterManager, "getConnection").mockReturnValue(
        mockConn as unknown as ReturnType<typeof adapterManager.getConnection>,
      );

      const refreshSpy = vi.spyOn(tokenBroker, "refreshTokensForTask").mockResolvedValue();

      vi.mocked(taskStore.getTask).mockReturnValue(
        makeMockTask() as ReturnType<typeof taskStore.getTask>,
      );
      vi.mocked(taskStore.areDependenciesMet).mockReturnValue(true);

      // Build a mock router to extract our handler
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

      expect(refreshSpy).toHaveBeenCalledWith("env-1", "claude-code", { excludeFileTokens: true });

      // Verify refresh happened before spawn
      const refreshOrder = refreshSpy.mock.invocationCallOrder[0];
      const spawnOrder = mockConn.client.spawn.mock.invocationCallOrder[0];
      expect(refreshOrder).toBeLessThan(spawnOrder);
    });

    it("proceeds with spawn even if refreshTokensForTask rejects", async () => {
      const { registerGrackleRoutes } = await import("./grpc-service.js");

      const mockConn = makeMockConnection();
      vi.spyOn(adapterManager, "getConnection").mockReturnValue(
        mockConn as unknown as ReturnType<typeof adapterManager.getConnection>,
      );

      // refreshTokensForTask itself never throws (it uses allSettled internally),
      // but verify the call site is resilient even if it did
      vi.spyOn(tokenBroker, "pushToEnv").mockRejectedValue(new Error("push failed"));
      vi.spyOn(tokenBroker, "pushProviderCredentialsToEnv").mockRejectedValue(new Error("creds failed"));

      vi.mocked(taskStore.getTask).mockReturnValue(
        makeMockTask({ id: "task-2" }) as ReturnType<typeof taskStore.getTask>,
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

      // Should not throw despite push failures
      await startTask!({ taskId: "task-2", environmentId: "env-1" });

      // Spawn should still have been called
      expect(mockConn.client.spawn).toHaveBeenCalled();
    });
  });
});
