/**
 * Unit tests for provisionEnvironment gRPC handler edge-cases.
 *
 * Force-teardown + status-broadcast paths are already covered in
 * grpc-force-provision.test.ts and grpc-env-broadcast.test.ts.
 * This file covers the remaining gaps:
 *   - Early-exit events (env not found, no adapter)
 *   - Provision-loop failure with the "don't clobber connected status" guard
 *   - adapter.connect failure path
 *   - Successful provision: ready event, markBootstrapped, recovery
 *   - Client disconnect mid-stream does not revert connected status
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock heavy dependencies before importing the module ──────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("@grackle-ai/test-utils");
  return createDatabaseMock();
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
    isReconnecting: vi.fn(() => false),
    streamRegistry: {
      getSubscriptionsForSession: vi.fn(() => []),
      subscribe: vi.fn(() => ({ fd: 0 })),
      unsubscribe: vi.fn(),
      createStream: vi.fn(() => {
        const iter = (async function* () {})();
        return Object.assign(iter, { id: "stream-1", cancel: vi.fn() });
      }),
    },
    processEventStream: vi.fn(),
    parseAdapterConfig: vi.fn(() => ({})),
    resolveBootstrapRuntime: vi.fn(() => "claude-code"),
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
  buildOrchestratorContext: vi.fn(() => ""),
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

// ── Import AFTER mocks ────────────────────────────────────────────

import { registerGrackleRoutes } from "./grpc-service.js";
import { envRegistry } from "@grackle-ai/database";
import { adapterManager, recoverSuspendedSessions } from "@grackle-ai/core";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import type { ConnectRouter } from "@connectrpc/connect";
import type { EnvironmentRow } from "@grackle-ai/database";

/**
 * Base environment row used across tests.
 * Status is "disconnected" (not "connected") so that the provision-failure
 * catch block's `status !== "connected"` guard resolves to true and properly
 * updates the status to "error".
 */
const FAKE_ENV: EnvironmentRow = {
  id: "test-env",
  displayName: "Test Env",
  adapterType: "local",
  adapterConfig: "{}",
  bootstrapped: true,
  status: "disconnected",
  lastSeen: "",
  envInfo: "",
  createdAt: "2025-01-01",
  powerlineToken: "tok-abc",
  githubAccountId: null,
  powerlineVersion: null,
};

/** Default fake connection returned by adapter.connect. */
const FAKE_CONN = { environmentId: "test-env" };

/** Extract gRPC handler implementations from the service registry. */
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

/** Drain an async generator and collect all yielded values. */
async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const value of gen) {
    results.push(value);
  }
  return results;
}

describe("gRPC provisionEnvironment edge cases", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set defaults that individual tests may override. (vi.clearAllMocks
    // only clears call history, not implementations — so these resets are
    // necessary to prevent state leakage between tests.)
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(adapterManager.getAdapter).mockReturnValue({
      connect: vi.fn().mockResolvedValue(FAKE_CONN),
      disconnect: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      destroy: vi.fn(),
    } as never);
    vi.mocked(reconnectOrProvision).mockImplementation(async function* () {});
    handlers = getHandlers();
  });

  // ── Early-exit guard paths ──────────────────────────────────────

  it("yields a single error event and returns when environment is not found", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(undefined);

    const gen = handlers.provisionEnvironment({
      id: "nonexistent",
      force: false,
    }) as AsyncGenerator;
    const events = await drain(gen);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stage: "error",
      message: expect.stringContaining("not found"),
    });
    expect(envRegistry.updateEnvironmentStatus).not.toHaveBeenCalled();
  });

  it("yields a single error event and returns when no adapter is registered", async () => {
    vi.mocked(adapterManager.getAdapter).mockReturnValue(undefined);

    const gen = handlers.provisionEnvironment({ id: "test-env", force: false }) as AsyncGenerator;
    const events = await drain(gen);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stage: "error",
      message: expect.stringContaining("No adapter"),
    });
    expect(envRegistry.updateEnvironmentStatus).not.toHaveBeenCalled();
  });

  // ── Provision loop failure ──────────────────────────────────────

  it("sets status to error and yields provision-failed event when loop throws", async () => {
    vi.mocked(reconnectOrProvision).mockImplementation(async function* () {
      throw new Error("provision error");
    });

    const gen = handlers.provisionEnvironment({ id: "test-env", force: false }) as AsyncGenerator;
    const events = await drain(gen);

    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "error");
    const errorEvent = events.find((e) => (e as { stage: string }).stage === "error");
    expect(errorEvent).toMatchObject({
      stage: "error",
      message: expect.stringContaining("Provision failed"),
    });
  });

  it("does not clobber connected status when provision loop fails on an already-connected env", async () => {
    // First getEnvironment call (line ~162) returns FAKE_ENV; second call
    // (inside the catch block, line ~220) returns an env whose status is
    // already "connected" — simulating a race where another path connected it.
    vi.mocked(envRegistry.getEnvironment)
      .mockReturnValueOnce(FAKE_ENV)
      .mockReturnValueOnce({ ...FAKE_ENV, status: "connected" });
    vi.mocked(reconnectOrProvision).mockImplementation(async function* () {
      throw new Error("race condition");
    });

    const gen = handlers.provisionEnvironment({ id: "test-env", force: false }) as AsyncGenerator;
    await drain(gen);

    // Status must NOT be set to "error" since the env is already "connected"
    expect(envRegistry.updateEnvironmentStatus).not.toHaveBeenCalledWith("test-env", "error");
  });

  // ── Connect failure ─────────────────────────────────────────────

  it("sets status to error and yields connection-failed event when adapter.connect throws", async () => {
    vi.mocked(adapterManager.getAdapter).mockReturnValue({
      connect: vi.fn().mockRejectedValue(new Error("port unreachable")),
      disconnect: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    } as never);

    const gen = handlers.provisionEnvironment({ id: "test-env", force: false }) as AsyncGenerator;
    const events = await drain(gen);

    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "error");
    const errorEvent = events.find((e) => (e as { stage: string }).stage === "error");
    expect(errorEvent).toMatchObject({
      stage: "error",
      message: expect.stringContaining("Connection failed"),
    });
  });

  // ── Successful provision ────────────────────────────────────────

  it("yields a ready event, calls markBootstrapped, and triggers session recovery on success", async () => {
    const gen = handlers.provisionEnvironment({ id: "test-env", force: false }) as AsyncGenerator;
    const events = await drain(gen);

    const readyEvent = events.find((e) => (e as { stage: string }).stage === "ready");
    expect(readyEvent).toMatchObject({ stage: "ready", progress: 1 });
    expect(envRegistry.markBootstrapped).toHaveBeenCalledWith("test-env");
    expect(recoverSuspendedSessions).toHaveBeenCalledWith("test-env", FAKE_CONN);
  });

  it("swallows recoverSuspendedSessions rejection and still yields ready event", async () => {
    vi.mocked(recoverSuspendedSessions).mockRejectedValue(new Error("recovery failed"));

    const gen = handlers.provisionEnvironment({ id: "test-env", force: false }) as AsyncGenerator;
    const events = await drain(gen);

    expect(events.some((e) => (e as { stage: string }).stage === "ready")).toBe(true);
  });

  // ── Client disconnect mid-stream ────────────────────────────────

  it("does not revert connected status when client disconnects after provision", async () => {
    const gen = handlers.provisionEnvironment({ id: "test-env", force: false }) as AsyncGenerator;

    // With an empty reconnectOrProvision (set in beforeEach), the first
    // gen.next() drives the generator through the provision loop and all
    // the way to the final `yield ready` — where it pauses.
    const firstResult = await gen.next();
    expect((firstResult.value as { stage: string }).stage).toBe("ready");

    // Simulate client disconnecting by throwing into the paused generator.
    // The try/catch around the final yield swallows the error.
    const thrown = await gen.throw(new Error("client disconnected"));
    expect(thrown.done).toBe(true);

    // Status must remain "connected", NOT reverted to "error".
    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "connected");
    expect(envRegistry.updateEnvironmentStatus).not.toHaveBeenCalledWith("test-env", "error");
  });
});
