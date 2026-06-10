/**
 * Unit tests for the `ensureSpawnConnection` helper extracted from spawnAgent.
 *
 * Tests the auto-provision path in isolation: connection cache hit, successful
 * provision, no-adapter failure, connect failure, and fire-and-forget recovery.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PreconditionError } from "@grackle-ai/common";

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
    isReconnecting: vi.fn(() => false),
    parseAdapterConfig: vi.fn(() => ({})),
    resolveBootstrapRuntime: vi.fn(() => "claude-code"),
    recoverSuspendedSessions: vi.fn().mockResolvedValue(undefined),
    clearReconnectState: vi.fn(),
    processEventStream: vi.fn(),
    cleanupLifecycleStream: vi.fn(),
    ensureLifecycleStream: vi.fn(),
  };
});

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  reconnectOrProvision: vi.fn(async function* () {}),
}));

// ── Local helper mocks (required by modules loaded transitively) ──

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

import { ensureSpawnConnection } from "./spawn-orchestration.js";
import { envRegistry } from "@grackle-ai/database";
import { adapterManager, emit, recoverSuspendedSessions } from "@grackle-ai/core";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import type { EnvironmentRow } from "@grackle-ai/database";
import type { PowerLineConnection } from "@grackle-ai/adapter-sdk";

/** Minimal environment row used across tests. */
const FAKE_ENV: EnvironmentRow = {
  id: "test-env",
  displayName: "Test Env",
  adapterType: "local",
  adapterConfig: "{}",
  bootstrapped: true,
  status: "connected",
  lastSeen: "",
  envInfo: "",
  createdAt: "2025-01-01",
  powerlineToken: "tok-abc",
  githubAccountId: null,
  powerlineVersion: null,
};

/** Build a fake PowerLineConnection. */
function makeFakeConn(): PowerLineConnection {
  return {
    environmentId: "test-env",
    port: 7433,
    transport: {
      createSession: vi.fn(() => ({ stream: (async function* () {})() })),
      reanimate: vi.fn(),
    } as never,
    ping: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ensureSpawnConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing connection immediately without provisioning", async () => {
    const existing = makeFakeConn();
    vi.mocked(adapterManager.getConnection).mockReturnValue(existing as never);

    const result = await ensureSpawnConnection("test-env", FAKE_ENV);

    expect(result).toBe(existing);
    expect(adapterManager.getAdapter).not.toHaveBeenCalled();
    expect(reconnectOrProvision).not.toHaveBeenCalled();
  });

  it("provisions and connects when no connection exists", async () => {
    vi.mocked(adapterManager.getConnection).mockReturnValue(undefined);
    const fakeConn = makeFakeConn();
    const fakeAdapter = {
      connect: vi.fn().mockResolvedValue(fakeConn),
      disconnect: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    const result = await ensureSpawnConnection("test-env", FAKE_ENV);

    expect(result).toBe(fakeConn);
    expect(adapterManager.setConnection).toHaveBeenCalledWith("test-env", fakeConn);
    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "connecting");
    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "connected");
    expect(envRegistry.markBootstrapped).toHaveBeenCalledWith("test-env");
    expect(emit).toHaveBeenCalledWith("environment.changed", {});
    expect(emit).toHaveBeenCalledWith(
      "environment.provision_progress",
      expect.objectContaining({ stage: "ready", progress: 1 }),
    );
    expect(recoverSuspendedSessions).toHaveBeenCalledWith("test-env", fakeConn);
  });

  it("throws PreconditionError when no adapter is registered for the env type", async () => {
    vi.mocked(adapterManager.getConnection).mockReturnValue(undefined);
    vi.mocked(adapterManager.getAdapter).mockReturnValue(undefined);

    await expect(ensureSpawnConnection("test-env", FAKE_ENV)).rejects.toBeInstanceOf(
      PreconditionError,
    );
    expect(envRegistry.updateEnvironmentStatus).not.toHaveBeenCalledWith("test-env", "connecting");
  });

  it("throws PreconditionError and sets status to error when adapter.connect rejects", async () => {
    vi.mocked(adapterManager.getConnection).mockReturnValue(undefined);
    const fakeAdapter = {
      connect: vi.fn().mockRejectedValue(new Error("connection refused")),
      disconnect: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

    await expect(ensureSpawnConnection("test-env", FAKE_ENV)).rejects.toBeInstanceOf(
      PreconditionError,
    );
    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "error");
    expect(emit).toHaveBeenCalledWith("environment.changed", {});
  });

  it("does not clobber connected status when a concurrent provision succeeds while this one fails", async () => {
    vi.mocked(adapterManager.getConnection).mockReturnValue(undefined);
    const fakeAdapter = {
      connect: vi.fn().mockRejectedValue(new Error("connection refused")),
      disconnect: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);
    // Simulate another caller having connected the environment concurrently
    vi.mocked(envRegistry.getEnvironment).mockReturnValue({
      ...FAKE_ENV,
      status: "connected",
    });

    await expect(ensureSpawnConnection("test-env", FAKE_ENV)).rejects.toBeInstanceOf(
      PreconditionError,
    );
    // Status must NOT be reverted to "error" — the concurrent provision won
    expect(envRegistry.updateEnvironmentStatus).not.toHaveBeenCalledWith("test-env", "error");
  });

  it("swallows recoverSuspendedSessions rejection (fire-and-forget)", async () => {
    vi.mocked(adapterManager.getConnection).mockReturnValue(undefined);
    const fakeConn = makeFakeConn();
    const fakeAdapter = {
      connect: vi.fn().mockResolvedValue(fakeConn),
      disconnect: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);
    vi.mocked(recoverSuspendedSessions).mockRejectedValue(new Error("recovery boom"));

    // Should resolve successfully even though recovery fails
    const result = await ensureSpawnConnection("test-env", FAKE_ENV);
    expect(result).toBe(fakeConn);
  });
});
