/**
 * Unit tests verifying that gRPC environment lifecycle methods
 * (provision, stop, destroy) broadcast environment updates to
 * WebSocket clients after each status transition.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock heavy dependencies before importing the module ──────────

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
  broadcastEnvironments: vi.fn(),
  envRowToWs: vi.fn(),
}));

vi.mock("./token-broker.js", () => ({
  pushToEnv: vi.fn(),
  pushCredentialsToEnv: vi.fn(),
  refreshTokensForTask: vi.fn(),
  listTokens: vi.fn(() => []),
  setToken: vi.fn(),
  deleteToken: vi.fn(),
}));

vi.mock("./env-registry.js", () => ({
  listEnvironments: vi.fn(() => []),
  getEnvironment: vi.fn(),
  addEnvironment: vi.fn(),
  removeEnvironment: vi.fn(),
  updateEnvironmentStatus: vi.fn(),
  markBootstrapped: vi.fn(),
  resetAllStatuses: vi.fn(),
}));

vi.mock("./session-store.js", () => ({
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
}));

vi.mock("./adapter-manager.js", () => ({
  getAdapter: vi.fn(),
  getConnection: vi.fn(() => undefined),
  setConnection: vi.fn(),
  removeConnection: vi.fn(),
  registerAdapter: vi.fn(),
  startHeartbeat: vi.fn(),
}));

vi.mock("./project-store.js", () => ({
  listProjects: vi.fn(() => []),
  getProject: vi.fn(() => undefined),
  createProject: vi.fn(),
  archiveProject: vi.fn(),
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
  getPersona: vi.fn(() => undefined),
  getPersonaByName: vi.fn(() => undefined),
  createPersona: vi.fn(),
  updatePersona: vi.fn(),
  deletePersona: vi.fn(),
}));

vi.mock("./adapters/adapter.js", () => ({
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

vi.mock("./processor-registry.js", () => ({
  get: vi.fn(() => undefined),
  lateBind: vi.fn(),
}));

vi.mock("./compute-task-status.js", () => ({
  computeTaskStatus: vi.fn(() => ({ status: "not_started", latestSessionId: "" })),
}));

vi.mock("./github-import.js", () => ({
  importGitHubIssues: vi.fn(),
}));

// Import AFTER mocks — use the mocked versions
import { registerGrackleRoutes } from "./grpc-service.js";
import { broadcastEnvironments } from "./ws-broadcast.js";
import * as envRegistry from "./env-registry.js";
import * as adapterManager from "./adapter-manager.js";
import type { ConnectRouter } from "@connectrpc/connect";

/** Fake environment row returned by getEnvironment. */
const FAKE_ENV = {
  id: "test-env",
  displayName: "Test Env",
  adapterType: "local",
  adapterConfig: "{}",
  defaultRuntime: "claude-code",
  bootstrapped: false,
  status: "disconnected",
  lastSeen: "",
  envInfo: "",
  createdAt: "2025-01-01",
  powerlineToken: "",
};

/**
 * Extract the service handlers from `registerGrackleRoutes` by
 * calling it with a fake router that captures the method map.
 */
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

describe("gRPC environment broadcast", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  describe("provisionEnvironment", () => {
    it("broadcasts after setting connecting status", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = {
        connect: vi.fn().mockRejectedValue(new Error("fail")),
        disconnect: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
      };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      const gen = handlers.provisionEnvironment({ id: "test-env" }) as AsyncGenerator;
      // Drain the generator
      for await (const _event of gen) { /* drain */ }

      // Should have broadcast after "connecting" and after "error"
      expect(broadcastEnvironments).toHaveBeenCalledTimes(2);
    });

    it("broadcasts after successful connection", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = {
        connect: vi.fn().mockResolvedValue({ client: {} }),
        disconnect: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
      };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      const gen = handlers.provisionEnvironment({ id: "test-env" }) as AsyncGenerator;
      // Drain the generator
      for await (const _event of gen) { /* drain */ }

      // "connecting" + "connected"
      expect(broadcastEnvironments).toHaveBeenCalledTimes(2);
      expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "connecting");
      expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "connected");
    });

    it("broadcasts after connection error", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = {
        connect: vi.fn().mockRejectedValue(new Error("timeout")),
        disconnect: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
      };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      const gen = handlers.provisionEnvironment({ id: "test-env" }) as AsyncGenerator;
      // Drain the generator
      for await (const _event of gen) { /* drain */ }

      expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "error");
      expect(broadcastEnvironments).toHaveBeenCalled();
    });
  });

  describe("stopEnvironment", () => {
    it("broadcasts after setting disconnected status", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = { stop: vi.fn(), disconnect: vi.fn(), destroy: vi.fn() };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      await handlers.stopEnvironment({ id: "test-env" });

      expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "disconnected");
      expect(broadcastEnvironments).toHaveBeenCalledTimes(1);
    });
  });

  describe("destroyEnvironment", () => {
    it("broadcasts after setting disconnected status", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = { destroy: vi.fn(), disconnect: vi.fn(), stop: vi.fn() };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      await handlers.destroyEnvironment({ id: "test-env" });

      expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "disconnected");
      expect(broadcastEnvironments).toHaveBeenCalledTimes(1);
    });
  });
});
