/**
 * Unit tests for the shared `runProvisionLoop` primitive.
 *
 * Covers: status connecting→connected, setConnection, markBootstrapped,
 * progress events yielded through, fire-and-forget recovery swallows errors,
 * provision-loop throw → ProvisionLoopError{phase:"provision"} + status error,
 * connect throw → ProvisionLoopError{phase:"connect"} + status error,
 * race guard (env already "connected") for both phases — status NOT reverted.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ProvisionLoopError } from "./provision-loop.js";

// ── Mock heavy dependencies before importing the module ──────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("@grackle-ai/test-utils");
  const mock = createDatabaseMock();
  mock.wire();
  return mock;
});

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
    adapterManager: {
      getAdapter: vi.fn(),
      getConnection: vi.fn(() => undefined),
      setConnection: vi.fn(),
      removeConnection: vi.fn(),
      registerAdapter: vi.fn(),
      startHeartbeat: vi.fn(),
    },
    recoverSuspendedSessions: vi.fn().mockResolvedValue(undefined),
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

import { runProvisionLoop } from "./provision-loop.js";
import { envRegistry } from "@grackle-ai/database";
import { adapterManager, emit, recoverSuspendedSessions } from "@grackle-ai/core";
import { reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import type { PowerLineConnection } from "@grackle-ai/adapter-sdk";

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

/** Build a minimal fake adapter with the given connect implementation. */
function makeAdapter(connect: ReturnType<typeof vi.fn>) {
  return {
    connect,
    disconnect: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
  };
}

/** Collect all yielded events from an async generator. */
async function collectEvents<T, R>(
  gen: AsyncGenerator<T, R>,
): Promise<{ events: T[]; returnValue: R }> {
  const events: T[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, returnValue: step.value };
}

describe("runProvisionLoop", () => {
  const ENV_ID = "test-env";
  const TOKEN = "tok-abc";
  const CONFIG = {};

  beforeEach(() => {
    vi.clearAllMocks();
    // vi.clearAllMocks clears call records but NOT implementations — restore defaults.
    vi.mocked(reconnectOrProvision).mockImplementation(async function* () {});
    vi.mocked(recoverSuspendedSessions).mockResolvedValue(undefined);
  });

  it("sets status to connecting, then connected; marks bootstrapped; stores connection", async () => {
    const fakeConn = makeFakeConn();
    const adapter = makeAdapter(vi.fn().mockResolvedValue(fakeConn));

    const { returnValue } = await collectEvents(
      runProvisionLoop(ENV_ID, adapter as never, CONFIG, TOKEN, true),
    );

    expect(returnValue).toBe(fakeConn);
    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith(ENV_ID, "connecting");
    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith(ENV_ID, "connected");
    expect(envRegistry.markBootstrapped).toHaveBeenCalledWith(ENV_ID);
    expect(adapterManager.setConnection).toHaveBeenCalledWith(ENV_ID, fakeConn);
    expect(emit).toHaveBeenCalledWith("environment.changed", {});
  });

  it("yields each ProvisionEvent from reconnectOrProvision", async () => {
    const events = [
      { stage: "provisioning", message: "step 1", progress: 0.5 },
      { stage: "installing", message: "step 2", progress: 0.8 },
    ];
    vi.mocked(reconnectOrProvision).mockImplementation(async function* () {
      for (const ev of events) {
        yield ev;
      }
    });
    const fakeConn = makeFakeConn();
    const adapter = makeAdapter(vi.fn().mockResolvedValue(fakeConn));

    const result = await collectEvents(
      runProvisionLoop(ENV_ID, adapter as never, CONFIG, TOKEN, false),
    );

    expect(result.events).toEqual(events);
    expect(result.returnValue).toBe(fakeConn);
  });

  it("swallows recoverSuspendedSessions rejection (fire-and-forget)", async () => {
    const fakeConn = makeFakeConn();
    const adapter = makeAdapter(vi.fn().mockResolvedValue(fakeConn));
    vi.mocked(recoverSuspendedSessions).mockRejectedValue(new Error("recovery boom"));

    const result = await collectEvents(
      runProvisionLoop(ENV_ID, adapter as never, CONFIG, TOKEN, true),
    );

    expect(result.returnValue).toBe(fakeConn);
    expect(recoverSuspendedSessions).toHaveBeenCalledWith(ENV_ID, fakeConn);
  });

  it("throws ProvisionLoopError{phase:'provision'} and sets status to error when reconnectOrProvision throws", async () => {
    vi.mocked(reconnectOrProvision).mockImplementation(async function* () {
      throw new Error("provision boom");
    });
    const adapter = makeAdapter(vi.fn());

    await expect(
      collectEvents(runProvisionLoop(ENV_ID, adapter as never, CONFIG, TOKEN, false)),
    ).rejects.toMatchObject({ name: "ProvisionLoopError", phase: "provision" });

    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith(ENV_ID, "error");
    expect(emit).toHaveBeenCalledWith("environment.changed", {});
  });

  it("throws ProvisionLoopError{phase:'connect'} and sets status to error when adapter.connect throws", async () => {
    const adapter = makeAdapter(vi.fn().mockRejectedValue(new Error("connect boom")));

    await expect(
      collectEvents(runProvisionLoop(ENV_ID, adapter as never, CONFIG, TOKEN, false)),
    ).rejects.toMatchObject({ name: "ProvisionLoopError", phase: "connect" });

    expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith(ENV_ID, "error");
    expect(emit).toHaveBeenCalledWith("environment.changed", {});
  });

  it("does NOT revert status to error when provision fails but env is already connected (race guard)", async () => {
    vi.mocked(reconnectOrProvision).mockImplementation(async function* () {
      throw new Error("provision boom");
    });
    const adapter = makeAdapter(vi.fn());
    // Simulate concurrent provision having connected the environment
    vi.mocked(envRegistry.getEnvironment).mockReturnValue({
      id: ENV_ID,
      displayName: "Test",
      adapterType: "local",
      adapterConfig: "{}",
      bootstrapped: true,
      status: "connected",
      lastSeen: "",
      envInfo: "",
      createdAt: "2025-01-01",
      powerlineToken: TOKEN,
      githubAccountId: null,
      powerlineVersion: null,
    });

    await expect(
      collectEvents(runProvisionLoop(ENV_ID, adapter as never, CONFIG, TOKEN, false)),
    ).rejects.toBeInstanceOf(ProvisionLoopError);

    // Status must NOT be set to "error" — the concurrent provision won
    expect(envRegistry.updateEnvironmentStatus).not.toHaveBeenCalledWith(ENV_ID, "error");
  });

  it("does NOT revert status to error when connect fails but env is already connected (race guard)", async () => {
    const adapter = makeAdapter(vi.fn().mockRejectedValue(new Error("connect boom")));
    // Simulate concurrent provision having connected the environment
    vi.mocked(envRegistry.getEnvironment).mockReturnValue({
      id: ENV_ID,
      displayName: "Test",
      adapterType: "local",
      adapterConfig: "{}",
      bootstrapped: true,
      status: "connected",
      lastSeen: "",
      envInfo: "",
      createdAt: "2025-01-01",
      powerlineToken: TOKEN,
      githubAccountId: null,
      powerlineVersion: null,
    });

    await expect(
      collectEvents(runProvisionLoop(ENV_ID, adapter as never, CONFIG, TOKEN, false)),
    ).rejects.toBeInstanceOf(ProvisionLoopError);

    // Status must NOT be set to "error" — the concurrent provision won
    expect(envRegistry.updateEnvironmentStatus).not.toHaveBeenCalledWith(ENV_ID, "error");
  });

  it("passes force=true to reconnectOrProvision when requested", async () => {
    const fakeConn = makeFakeConn();
    const adapter = makeAdapter(vi.fn().mockResolvedValue(fakeConn));

    await collectEvents(runProvisionLoop(ENV_ID, adapter as never, CONFIG, TOKEN, false, true));

    expect(reconnectOrProvision).toHaveBeenCalledWith(ENV_ID, adapter, CONFIG, TOKEN, false, true);
  });
});
