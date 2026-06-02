/**
 * Unit tests for session cleanup in stopEnvironment / destroyEnvironment.
 *
 * Verifies that any active sessions are killed BEFORE the adapter is stopped
 * or destroyed, so the kill signal can reach PowerLine via the live connection.
 *
 * Regression coverage for #1485 (zombie sessions on env stop/destroy).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("./test-utils/mock-database.js");
  return createDatabaseMock();
});

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
  SystemPromptBuilder: vi.fn().mockImplementation(() => ({ build: () => "" })),
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

const FAKE_SESSION_A = {
  id: "session-a",
  environmentId: "test-env",
  status: "running",
  taskId: "task-a",
};

const FAKE_SESSION_B = {
  id: "session-b",
  environmentId: "test-env",
  status: "idle",
  taskId: "task-b",
};

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
    handlers = getHandlers();
  });

  it("kills the active session before calling adapter.stop", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getAllActiveForEnv).mockReturnValue([FAKE_SESSION_A] as never);
    vi.mocked(taskStore.getTask).mockReturnValue({
      id: "task-a",
      workspaceId: "ws-1",
    } as never);
    const fakeAdapter = {
      stop: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.stopEnvironment({ id: "test-env" });

    expect(sessionStore.updateSession).toHaveBeenCalledWith(
      "session-a",
      "stopped",
      undefined,
      undefined,
      "killed",
    );
    expect(fakeAdapter.stop).toHaveBeenCalledWith("test-env", expect.anything());

    // Order: updateSession (kill) before adapter.stop.
    const killOrder = vi.mocked(sessionStore.updateSession).mock.invocationCallOrder[0];
    const stopOrder = fakeAdapter.stop.mock.invocationCallOrder[0];
    expect(killOrder).toBeLessThan(stopOrder);
  });

  it("kills every active session when more than one exists", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getAllActiveForEnv).mockReturnValue([
      FAKE_SESSION_A,
      FAKE_SESSION_B,
    ] as never);
    const fakeAdapter = {
      stop: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.stopEnvironment({ id: "test-env" });

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
    expect(cleanupLifecycleStream).toHaveBeenCalledWith("session-a");
    expect(cleanupLifecycleStream).toHaveBeenCalledWith("session-b");
  });

  it("is a no-op for sessions when no active session exists", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getAllActiveForEnv).mockReturnValue([]);
    const fakeAdapter = {
      stop: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.stopEnvironment({ id: "test-env" });

    expect(sessionStore.updateSession).not.toHaveBeenCalled();
    expect(cleanupLifecycleStream).not.toHaveBeenCalled();
    expect(fakeAdapter.stop).toHaveBeenCalledWith("test-env", expect.anything());
    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "disconnected");
  });

  it("cleans up lifecycle stream and stream subscriptions for each killed session", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getAllActiveForEnv).mockReturnValue([FAKE_SESSION_A] as never);
    const fakeAdapter = {
      stop: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await handlers.stopEnvironment({ id: "test-env" });

    expect(cleanupLifecycleStream).toHaveBeenCalledWith("session-a");
    expect(streamRegistry.getSubscriptionsForSession).toHaveBeenCalledWith("session-a");
  });

  it("throws NotFound when the environment does not exist and does not touch sessions", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(undefined);

    await expect(handlers.stopEnvironment({ id: "missing" })).rejects.toThrow(/not found/i);
    expect(sessionStore.getAllActiveForEnv).not.toHaveBeenCalled();
    expect(sessionStore.updateSession).not.toHaveBeenCalled();
  });
});

describe("gRPC destroyEnvironment session cleanup (#1485)", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  it("kills the active session before calling adapter.destroy", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getAllActiveForEnv).mockReturnValue([FAKE_SESSION_A] as never);
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
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getAllActiveForEnv).mockReturnValue([
      FAKE_SESSION_A,
      FAKE_SESSION_B,
    ] as never);
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
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(sessionStore.getAllActiveForEnv).mockReturnValue([]);
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
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(undefined);

    await expect(handlers.destroyEnvironment({ id: "missing" })).rejects.toThrow(/not found/i);
    expect(sessionStore.getAllActiveForEnv).not.toHaveBeenCalled();
    expect(sessionStore.updateSession).not.toHaveBeenCalled();
  });
});
