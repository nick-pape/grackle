/**
 * Unit tests for force-provision logic in the gRPC provisionEnvironment handler.
 *
 * Verifies that when `force=true`, active sessions are killed, the adapter is
 * disconnected, and reconnectOrProvision receives the force flag.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock heavy dependencies before importing the module ──────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("./test-utils/mock-database.js");
  return createDatabaseMock();
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

vi.mock("./lifecycle.js", () => ({
  cleanupLifecycleStream: vi.fn(),
  ensureLifecycleStream: vi.fn(),
}));

vi.mock("./stream-registry.js", () => ({
  getSubscriptionsForSession: vi.fn(() => []),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("./session-recovery.js", () => ({
  recoverSuspendedSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./auto-reconnect.js", () => ({
  clearReconnectState: vi.fn(),
}));

vi.mock("./knowledge-init.js", () => ({
  initKnowledge: vi.fn(),
}));

vi.mock("./reanimate-agent.js", () => ({
  reanimateAgent: vi.fn(),
}));

vi.mock("./github-import.js", () => ({
  importGitHubIssues: vi.fn(),
}));

vi.mock("./pipe-delivery.js", () => ({
  deliverPipeMessage: vi.fn(),
}));

vi.mock("./utils/exec.js", () => ({
  execAsync: vi.fn(),
}));

vi.mock("./utils/network.js", () => ({
  findFreePort: vi.fn(),
}));

vi.mock("./utils/format-gh-error.js", () => ({
  formatGhError: vi.fn((e: unknown) => String(e)),
}));

// Import AFTER mocks — use the mocked versions
import { registerGrackleRoutes } from "./grpc-service.js";
import { envRegistry, sessionStore, taskStore } from "@grackle-ai/database";
import * as adapterManager from "./adapter-manager.js";
import * as streamHub from "./stream-hub.js";
import * as streamRegistry from "./stream-registry.js";
import { cleanupLifecycleStream } from "./lifecycle.js";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import type { ConnectRouter } from "@connectrpc/connect";

/** Fake environment row. */
const FAKE_ENV = {
  id: "test-env",
  displayName: "Test Env",
  adapterType: "local",
  adapterConfig: "{}",
  bootstrapped: true,
  status: "connected",
  lastSeen: "",
  envInfo: "",
  createdAt: "2025-01-01",
  powerlineToken: "tok-123",
};

/** Fake active session row. */
const FAKE_SESSION = {
  id: "session-1",
  environmentId: "test-env",
  status: "running",
  taskId: "task-1",
};

/** Extract the service handlers from registerGrackleRoutes. */
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

/** Drain an async generator and collect yielded values. */
async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const value of gen) {
    results.push(value);
  }
  return results;
}

describe("gRPC provisionEnvironment with force", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  it("kills active session when force=true", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(FAKE_SESSION as never);
    vi.mocked(taskStore.getTask).mockReturnValue({ id: "task-1", workspaceId: "ws-1" } as never);
    const fakeAdapter = {
      connect: vi.fn().mockResolvedValue({ client: {} }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    const gen = handlers.provisionEnvironment({ id: "test-env", force: true }) as AsyncGenerator;
    await drain(gen);

    // Session should be killed
    expect(sessionStore.updateSession).toHaveBeenCalledWith(
      "session-1", "stopped", undefined, undefined, "killed",
    );
    // STATUS event should be published
    expect(streamHub.publish).toHaveBeenCalled();
    // Lifecycle stream cleaned up
    expect(cleanupLifecycleStream).toHaveBeenCalledWith("session-1");
    // Stream subscriptions cleaned up
    expect(streamRegistry.getSubscriptionsForSession).toHaveBeenCalledWith("session-1");
  });

  it("disconnects adapter and removes connection when force=true", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    const fakeAdapter = {
      connect: vi.fn().mockResolvedValue({ client: {} }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    const gen = handlers.provisionEnvironment({ id: "test-env", force: true }) as AsyncGenerator;
    await drain(gen);

    expect(fakeAdapter.disconnect).toHaveBeenCalledWith("test-env");
    expect(adapterManager.removeConnection).toHaveBeenCalledWith("test-env");
  });

  it("passes force flag to reconnectOrProvision", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    const fakeAdapter = {
      connect: vi.fn().mockResolvedValue({ client: {} }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    const gen = handlers.provisionEnvironment({ id: "test-env", force: true }) as AsyncGenerator;
    await drain(gen);

    expect(reconnectOrProvision).toHaveBeenCalledWith(
      "test-env",
      expect.anything(),
      expect.anything(),
      "tok-123",
      true,
      true,
    );
  });

  it("does not kill sessions or disconnect when force=false", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    const fakeAdapter = {
      connect: vi.fn().mockResolvedValue({ client: {} }),
      disconnect: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    const gen = handlers.provisionEnvironment({ id: "test-env", force: false }) as AsyncGenerator;
    await drain(gen);

    expect(sessionStore.getActiveForEnv).not.toHaveBeenCalled();
    expect(fakeAdapter.disconnect).not.toHaveBeenCalled();
    expect(adapterManager.removeConnection).not.toHaveBeenCalled();
  });

  it("handles adapter disconnect failure gracefully", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    const fakeAdapter = {
      connect: vi.fn().mockResolvedValue({ client: {} }),
      disconnect: vi.fn().mockRejectedValue(new Error("disconnect failed")),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    // Should not throw even though disconnect fails
    const gen = handlers.provisionEnvironment({ id: "test-env", force: true }) as AsyncGenerator;
    await drain(gen);

    expect(fakeAdapter.disconnect).toHaveBeenCalledWith("test-env");
    // removeConnection still called after failed disconnect
    expect(adapterManager.removeConnection).toHaveBeenCalledWith("test-env");
  });

  it("skips session kill when no active session exists", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    const fakeAdapter = {
      connect: vi.fn().mockResolvedValue({ client: {} }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    const gen = handlers.provisionEnvironment({ id: "test-env", force: true }) as AsyncGenerator;
    await drain(gen);

    expect(sessionStore.updateSession).not.toHaveBeenCalled();
    expect(cleanupLifecycleStream).not.toHaveBeenCalled();
  });
});
