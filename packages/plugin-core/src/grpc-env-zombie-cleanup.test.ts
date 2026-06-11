/**
 * Unit tests for session cleanup in stopEnvironment / destroyEnvironment.
 *
 * Verifies the two paths:
 *   - stopEnvironment SUSPENDS active sessions before adapter.stop. Stop is a
 *     recoverable transition -- recoverSuspendedSessions reanimates them when
 *     the env is re-provisioned. Lifecycle/subscription streams are left in
 *     place because they are reused by the resumed session.
 *   - destroyEnvironment KILLS active sessions before adapter.destroy (kill
 *     signal needs the live PowerLine connection) and cleans up lifecycle +
 *     subscription streams since the environment is gone for good.
 *
 * Regression coverage for #1485 (zombie sessions on env stop/destroy).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { setupTestDatabase } from "@grackle-ai/test-utils/db";

// NOTE: @grackle-ai/database is NOT mocked -- real stores run against
// an in-memory SQLite database initialized by setupTestDatabase().

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

vi.mock("./knowledge-init.js", () => ({ initKnowledge: vi.fn() }));
vi.mock("./reanimate-agent.js", () => ({ reanimateAgent: vi.fn() }));
vi.mock("./github-import.js", () => ({ importGitHubIssues: vi.fn() }));
vi.mock("./pipe-delivery.js", () => ({ deliverPipeMessage: vi.fn() }));
vi.mock("./utils/exec.js", () => ({ execAsync: vi.fn() }));
vi.mock("./utils/network.js", () => ({ findFreePort: vi.fn() }));
vi.mock("./utils/format-gh-error.js", () => ({
  formatGhError: vi.fn((e: unknown) => String(e)),
}));

import { registerGrackleRoutes } from "./grpc-service.js";
import { envRegistry, sessionStore, taskStore } from "@grackle-ai/database";
import { adapterManager, streamRegistry, cleanupLifecycleStream } from "@grackle-ai/core";
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

describe("gRPC stopEnvironment session cleanup (#1485)", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    testDb.truncateAll();
    insertBaseEntities();
    handlers = getHandlers();

    // Spy on store methods for call-order and assertion tracking
    vi.spyOn(sessionStore, "suspendSession");
    vi.spyOn(sessionStore, "updateSession");
    vi.spyOn(sessionStore, "getAllActiveForEnv");
    vi.spyOn(envRegistry, "updateEnvironmentStatus");
  });

  it("suspends the active session before calling adapter.stop", async () => {
    // Insert a workspace and an active session
    taskStore.insertTask({
      id: "task-a",
      workspaceId: undefined,
      title: "Task A",
      description: "",
      branch: "ws-1/task-a",
      dependsOn: [],
      parentTaskId: "",
      depth: 0,
      canDecompose: false,
      injectKnowledge: true,
      defaultPersonaId: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
    });
    sessionStore.createSession("session-a", "test-env", "stub", "", "claude", "/tmp/log", "task-a");
    sessionStore.updateSession("session-a", "running" as never);
    // Clear the spy call counts from setup inserts
    vi.mocked(sessionStore.updateSession).mockClear();

    const fakeAdapter = {
      stop: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.stopEnvironment({ id: "test-env" });

    expect(sessionStore.suspendSession).toHaveBeenCalledWith("session-a");
    expect(sessionStore.updateSession).not.toHaveBeenCalled();
    expect(fakeAdapter.stop).toHaveBeenCalledWith("test-env", expect.anything());

    // Order: suspendSession before adapter.stop.
    const suspendOrder = vi.mocked(sessionStore.suspendSession).mock.invocationCallOrder[0];
    const stopOrder = fakeAdapter.stop.mock.invocationCallOrder[0];
    expect(suspendOrder).toBeLessThan(stopOrder);
  });

  it("suspends every active session when more than one exists", async () => {
    taskStore.insertTask({
      id: "task-a",
      workspaceId: undefined,
      title: "Task A",
      description: "",
      branch: "ws-1/task-a",
      dependsOn: [],
      parentTaskId: "",
      depth: 0,
      canDecompose: false,
      injectKnowledge: true,
      defaultPersonaId: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
    });
    sessionStore.createSession("session-a", "test-env", "stub", "", "claude", "/tmp/log", "task-a");
    sessionStore.updateSession("session-a", "running" as never);
    taskStore.insertTask({
      id: "task-b",
      workspaceId: undefined,
      title: "Task B",
      description: "",
      branch: "ws-1/task-b",
      dependsOn: [],
      parentTaskId: "",
      depth: 0,
      canDecompose: false,
      injectKnowledge: true,
      defaultPersonaId: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
    });
    sessionStore.createSession("session-b", "test-env", "stub", "", "claude", "/tmp/log", "task-b");
    sessionStore.updateSession("session-b", "idle" as never);

    const fakeAdapter = {
      stop: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.stopEnvironment({ id: "test-env" });

    expect(sessionStore.suspendSession).toHaveBeenCalledWith("session-a");
    expect(sessionStore.suspendSession).toHaveBeenCalledWith("session-b");
  });

  it("does NOT clean up lifecycle streams (session is recoverable on re-provision)", async () => {
    taskStore.insertTask({
      id: "task-a",
      workspaceId: undefined,
      title: "Task A",
      description: "",
      branch: "ws-1/task-a",
      dependsOn: [],
      parentTaskId: "",
      depth: 0,
      canDecompose: false,
      injectKnowledge: true,
      defaultPersonaId: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
    });
    sessionStore.createSession("session-a", "test-env", "stub", "", "claude", "/tmp/log", "task-a");
    sessionStore.updateSession("session-a", "running" as never);

    const fakeAdapter = {
      stop: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.stopEnvironment({ id: "test-env" });

    expect(cleanupLifecycleStream).not.toHaveBeenCalled();
    expect(streamRegistry.unsubscribe).not.toHaveBeenCalled();
  });

  it("is a no-op for sessions when no active session exists", async () => {
    const fakeAdapter = {
      stop: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.stopEnvironment({ id: "test-env" });

    expect(sessionStore.suspendSession).not.toHaveBeenCalled();
    expect(sessionStore.updateSession).not.toHaveBeenCalled();
    expect(fakeAdapter.stop).toHaveBeenCalledWith("test-env", expect.anything());
    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "disconnected");
  });

  it("throws NotFound when the environment does not exist and does not touch sessions", async () => {
    // Use a non-existent env ID -- real getEnvironment returns undefined
    await expect(handlers.stopEnvironment({ id: "missing" })).rejects.toThrow(/not found/i);
    expect(sessionStore.getAllActiveForEnv).not.toHaveBeenCalled();
    expect(sessionStore.suspendSession).not.toHaveBeenCalled();
    expect(sessionStore.updateSession).not.toHaveBeenCalled();
  });
});

describe("gRPC destroyEnvironment session cleanup (#1485)", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    testDb.truncateAll();
    insertBaseEntities();
    handlers = getHandlers();

    // Spy on store methods for call-order and assertion tracking
    vi.spyOn(sessionStore, "updateSession");
    vi.spyOn(sessionStore, "getAllActiveForEnv");
    vi.spyOn(envRegistry, "updateEnvironmentStatus");
  });

  it("kills the active session before calling adapter.destroy", async () => {
    taskStore.insertTask({
      id: "task-a",
      workspaceId: undefined,
      title: "Task A",
      description: "",
      branch: "ws-1/task-a",
      dependsOn: [],
      parentTaskId: "",
      depth: 0,
      canDecompose: false,
      injectKnowledge: true,
      defaultPersonaId: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
    });
    sessionStore.createSession("session-a", "test-env", "stub", "", "claude", "/tmp/log", "task-a");
    sessionStore.updateSession("session-a", "running" as never);
    // Clear the spy call counts from the setup updateSession call
    vi.mocked(sessionStore.updateSession).mockClear();

    const fakeAdapter = {
      stop: vi.fn(),
      disconnect: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.destroyEnvironment({ id: "test-env" });

    expect(sessionStore.updateSession).toHaveBeenCalledWith(
      "session-a",
      "stopped",
      undefined,
      undefined,
      "killed",
    );
    expect(fakeAdapter.destroy).toHaveBeenCalledWith("test-env", expect.anything());

    const killOrder = vi.mocked(sessionStore.updateSession).mock.invocationCallOrder[0];
    const destroyOrder = fakeAdapter.destroy.mock.invocationCallOrder[0];
    expect(killOrder).toBeLessThan(destroyOrder);
  });

  it("kills every active session when more than one exists", async () => {
    taskStore.insertTask({
      id: "task-a",
      workspaceId: undefined,
      title: "Task A",
      description: "",
      branch: "ws-1/task-a",
      dependsOn: [],
      parentTaskId: "",
      depth: 0,
      canDecompose: false,
      injectKnowledge: true,
      defaultPersonaId: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
    });
    sessionStore.createSession("session-a", "test-env", "stub", "", "claude", "/tmp/log", "task-a");
    sessionStore.updateSession("session-a", "running" as never);
    taskStore.insertTask({
      id: "task-b",
      workspaceId: undefined,
      title: "Task B",
      description: "",
      branch: "ws-1/task-b",
      dependsOn: [],
      parentTaskId: "",
      depth: 0,
      canDecompose: false,
      injectKnowledge: true,
      defaultPersonaId: "",
      tokenBudget: 0,
      costBudgetMillicents: 0,
    });
    sessionStore.createSession("session-b", "test-env", "stub", "", "claude", "/tmp/log", "task-b");
    sessionStore.updateSession("session-b", "idle" as never);
    // Clear the spy call counts from the setup updateSession calls
    vi.mocked(sessionStore.updateSession).mockClear();

    const fakeAdapter = {
      stop: vi.fn(),
      disconnect: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.destroyEnvironment({ id: "test-env" });

    expect(sessionStore.updateSession).toHaveBeenCalledWith(
      "session-a",
      "stopped",
      undefined,
      undefined,
      "killed",
    );
    expect(sessionStore.updateSession).toHaveBeenCalledWith(
      "session-b",
      "stopped",
      undefined,
      undefined,
      "killed",
    );
  });

  it("is a no-op for sessions when no active session exists", async () => {
    const fakeAdapter = {
      stop: vi.fn(),
      disconnect: vi.fn(),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.destroyEnvironment({ id: "test-env" });

    expect(sessionStore.updateSession).not.toHaveBeenCalled();
    expect(cleanupLifecycleStream).not.toHaveBeenCalled();
    expect(fakeAdapter.destroy).toHaveBeenCalledWith("test-env", expect.anything());
    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "disconnected");
  });

  it("throws NotFound when the environment does not exist and does not touch sessions", async () => {
    await expect(handlers.destroyEnvironment({ id: "missing" })).rejects.toThrow(/not found/i);
    expect(sessionStore.getAllActiveForEnv).not.toHaveBeenCalled();
    expect(sessionStore.updateSession).not.toHaveBeenCalled();
  });
});
