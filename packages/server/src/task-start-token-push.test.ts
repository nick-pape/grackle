/**
 * Unit tests verifying that token + credential push happens before each task
 * spawn, and that failures are non-blocking.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock heavy dependencies before importing modules under test ─────

vi.mock("./db.js", async () => {
  return await import("./test-db.js");
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
}));

vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

vi.mock("./env-registry.js", () => ({
  listEnvironments: vi.fn(() => []),
  getEnvironment: vi.fn(() => ({ adapterType: "local" })),
  addEnvironment: vi.fn(),
  removeEnvironment: vi.fn(),
  updateEnvironmentStatus: vi.fn(),
  markBootstrapped: vi.fn(),
}));

vi.mock("./workspace-store.js", () => ({
  listWorkspaces: vi.fn(() => []),
  getWorkspace: vi.fn(() => ({
    id: "proj-1",
    name: "Test Workspace",
    defaultEnvironmentId: "env-1",
    status: "active",
    createdAt: new Date().toISOString(),
  })),
  createWorkspace: vi.fn(),
  archiveWorkspace: vi.fn(),
}));

vi.mock("./task-store.js", () => ({
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
}));

vi.mock("./finding-store.js", () => ({
  queryFindings: vi.fn(() => []),
  postFinding: vi.fn(),
}));

vi.mock("./persona-store.js", () => ({
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
}));

vi.mock("./settings-store.js", () => ({
  getSetting: vi.fn((key: string) => key === "default_persona_id" ? "claude-code" : undefined),
  setSetting: vi.fn(),
}));

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  reconnectOrProvision: vi.fn(async function* () {}),
}));

vi.mock("./utils/system-context.js", () => ({
  buildTaskSystemContext: vi.fn(() => ""),
}));

vi.mock("./utils/slugify.js", () => ({
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-")),
}));

vi.mock("./event-processor.js", () => ({
  processEventStream: vi.fn(),
}));

vi.mock("./utils/exec.js", () => ({
  exec: vi.fn(),
}));

const { mockBuildProviderTokenBundle } = vi.hoisted(() => ({
  mockBuildProviderTokenBundle: vi.fn(),
}));

vi.mock("./credential-providers.js", () => ({
  buildProviderTokenBundle: mockBuildProviderTokenBundle,
  getCredentialProviders: vi.fn(() => ({
    claude: "off",
    github: "off",
    copilot: "off",
    codex: "off",
  })),
  setCredentialProviders: vi.fn(),
}));

// Import AFTER mocks
import * as tokenBroker from "./token-broker.js";
import * as adapterManager from "./adapter-manager.js";
import * as taskStore from "./task-store.js";
import { sqlite } from "./test-db.js";
import { logger } from "./logger.js";
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
      persona_id         TEXT NOT NULL DEFAULT ''
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
    it("pushes provider token bundle when providers are enabled", async () => {
      const mockBundle = create(powerline.TokenBundleSchema, {
        tokens: [
          create(powerline.TokenItemSchema, {
            name: "anthropic-api-key",
            type: "env_var",
            envVar: "ANTHROPIC_API_KEY",
            value: "sk-test",
          }),
        ],
      });
      mockBuildProviderTokenBundle.mockReturnValue(mockBundle);

      const mockConn = makeMockConnection();
      vi.spyOn(adapterManager, "getConnection").mockReturnValue(
        mockConn as unknown as ReturnType<typeof adapterManager.getConnection>,
      );

      await tokenBroker.pushProviderCredentialsToEnv("env-1");

      expect(mockConn.client.pushTokens).toHaveBeenCalledOnce();
      const bundle = mockConn.client.pushTokens.mock.calls[0][0];
      expect(bundle.tokens).toHaveLength(1);
      expect(bundle.tokens[0].envVar).toBe("ANTHROPIC_API_KEY");
    });

    it("skips push when provider bundle is empty", async () => {
      mockBuildProviderTokenBundle.mockReturnValue(
        create(powerline.TokenBundleSchema, { tokens: [] }),
      );

      const mockConn = makeMockConnection();
      vi.spyOn(adapterManager, "getConnection").mockReturnValue(
        mockConn as unknown as ReturnType<typeof adapterManager.getConnection>,
      );

      await tokenBroker.pushProviderCredentialsToEnv("env-1");

      expect(mockConn.client.pushTokens).not.toHaveBeenCalled();
    });

    it("is a no-op when environment is not connected", async () => {
      vi.spyOn(adapterManager, "getConnection").mockReturnValue(undefined);

      // Should not throw
      await tokenBroker.pushProviderCredentialsToEnv("env-missing");
    });
  });

  describe("refreshTokensForTask()", () => {
    it("logs warnings but does not throw when pushes fail", async () => {
      mockBuildProviderTokenBundle.mockReturnValue(
        create(powerline.TokenBundleSchema, {
          tokens: [
            create(powerline.TokenItemSchema, {
              name: "test",
              type: "env_var",
              envVar: "TEST",
              value: "x",
            }),
          ],
        }),
      );

      const mockConn = makeMockConnection();
      mockConn.client.pushTokens.mockRejectedValue(new Error("gRPC unavailable"));
      vi.spyOn(adapterManager, "getConnection").mockReturnValue(
        mockConn as unknown as ReturnType<typeof adapterManager.getConnection>,
      );

      // Should not throw despite pushTokens rejecting
      await tokenBroker.refreshTokensForTask("env-1");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ environmentId: "env-1" }),
        "Failed to push tokens before task start",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ environmentId: "env-1" }),
        "Failed to push provider credentials before task start",
      );
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
