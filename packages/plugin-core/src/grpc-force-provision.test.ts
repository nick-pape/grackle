/**
 * Unit tests for force-provision logic in the gRPC provisionEnvironment handler.
 *
 * Verifies that when `force=true`, active sessions are killed, the adapter is
 * disconnected, and reconnectOrProvision receives the force flag.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { setupTestDatabase } from "@grackle-ai/test-utils";

// ── Mock heavy dependencies before importing the module ──────────

// NOTE: @grackle-ai/database is NOT mocked -- real stores run against
// an in-memory SQLite database initialized by setupTestDatabase().

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
    tokenPush: {
      authenticateForRuntime: vi.fn(),
    },
    adapterManager: {
      getAdapter: vi.fn(),
      getConnection: vi.fn(() => undefined),
      setConnection: vi.fn(),
      removeConnection: vi.fn(),
      registerAdapter: vi.fn(),
      startHeartbeat: vi.fn(),
    },
    streamRegistry: {
      getSubscriptionsForSession: vi.fn(() => []),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    },
    processEventStream: vi.fn(),
    clearReconnectState: vi.fn(),
    recoverSuspendedSessions: vi.fn().mockResolvedValue(undefined),
    cleanupLifecycleStream: vi.fn(),
    ensureLifecycleStream: vi.fn(),
  };
});

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  reconnectOrProvision: vi.fn(async function* () {}),
}));

vi.mock("@grackle-ai/prompt", () => ({
  SystemPromptBuilder: vi.fn(function () {
    return { build: () => "" };
  }),
  buildTaskPrompt: vi.fn((title: string) => title),
}));

vi.mock("./compute-task-status.js", () => ({
  computeTaskStatus: vi.fn(() => ({ status: "not_started", latestSessionId: "" })),
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

// Import AFTER mocks -- use the mocked versions
import { registerGrackleRoutes } from "./grpc-service.js";
import { envRegistry, sessionStore, taskStore } from "@grackle-ai/database";
import {
  adapterManager,
  streamHub,
  streamRegistry,
  cleanupLifecycleStream,
} from "@grackle-ai/core";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import type { ConnectRouter } from "@connectrpc/connect";

// ── Test DB ───────────────────────────────────────────────────

const testDb = setupTestDatabase();
afterAll(() => testDb.cleanup());

// ── Helpers ───────────────────────────────────────────────────

function insertBaseEntities(): void {
  envRegistry.addEnvironment("test-env", "Test Env", "local", "{}");
  envRegistry.markBootstrapped("test-env");
  envRegistry.updateEnvironmentStatus("test-env", "connected");
}

function insertActiveSession(): void {
  taskStore.createTask("task-1", undefined, "Task 1", "", [], "ws-1");
  sessionStore.createSession("session-1", "test-env", "stub", "", "claude", "/tmp/log", "task-1");
  sessionStore.updateSession("session-1", "running" as never);
}

/** Extract the service handlers from registerGrackleRoutes. */
function getHandlers(): Record<string, (...args: unknown[]) => unknown> {
  let handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const fakeRouter = {
    service(_def: unknown, impl: Record<string, (...args: unknown[]) => unknown>) {
      handlers = { ...handlers, ...impl };
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
    testDb.truncateAll();
    insertBaseEntities();
    handlers = getHandlers();

    // Spy on store methods for assertion tracking
    vi.spyOn(sessionStore, "updateSession");
    vi.spyOn(sessionStore, "getActiveForEnv");
  });

  it("kills active session when force=true", async () => {
    insertActiveSession();
    // Clear the spy from insertActiveSession's updateSession call
    vi.mocked(sessionStore.updateSession).mockClear();

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
      "session-1",
      "stopped",
      undefined,
      undefined,
      "killed",
    );
    // STATUS event should be published
    expect(streamHub.publish).toHaveBeenCalled();
    // Lifecycle stream cleaned up
    expect(cleanupLifecycleStream).toHaveBeenCalledWith("session-1");
    // Stream subscriptions cleaned up
    expect(streamRegistry.getSubscriptionsForSession).toHaveBeenCalledWith("session-1");
  });

  it("disconnects adapter and removes connection when force=true", async () => {
    // No active session -- just test disconnect path
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
    // No active session
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
      expect.any(String),
      true,
      true,
    );
  });

  it("does not kill sessions or disconnect when force=false", async () => {
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
    // No active session
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
    // No session inserted
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
