import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProvisionEvent } from "@grackle-ai/adapter-sdk";
import { FatalAdapterError } from "@grackle-ai/adapter-sdk";
import { CodespaceNotFoundError } from "./codespace.js";

// ── Mock adapter-sdk (tunnel/process functions that can't be DI'd) ──
interface MockTunnelInstance {
  localPort: number;
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const mocks: {
  tunnelInstances: MockTunnelInstance[];
  tunnelOpenCallCount: number;
  tunnelOpenFailOnCall: number;
  MockTunnelClass: new (localPort: number) => unknown;
} = vi.hoisted(() => {
  // Use a single object so the class closures and the test both mutate the same reference.
  const m: {
    tunnelInstances: MockTunnelInstance[];
    tunnelOpenCallCount: number;
    tunnelOpenFailOnCall: number;
    MockTunnelClass: new (localPort: number) => unknown;
  } = {
    tunnelInstances: [],
    tunnelOpenCallCount: 0,
    tunnelOpenFailOnCall: -1,
    MockTunnelClass: undefined!,
  };

  m.MockTunnelClass = class {
    public localPort: number;
    public close = vi.fn();
    public open = vi.fn().mockImplementation(async () => {
      m.tunnelOpenCallCount++;
      if (m.tunnelOpenCallCount === m.tunnelOpenFailOnCall) {
        throw new Error("tunnel open failed");
      }
    });
    public isAlive = vi.fn().mockReturnValue(true);
    public constructor(localPort: number) {
      this.localPort = localPort;
      m.tunnelInstances.push(this as unknown as MockTunnelInstance);
    }
  };

  return m;
});

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@grackle-ai/adapter-sdk")>();
  return {
    ...original,
    ProcessTunnel: mocks.MockTunnelClass,
    ProcessReverseTunnel: mocks.MockTunnelClass,
  };
});

import { CodespaceAdapter } from "./codespace.js";

// ── Helpers ─────────────────────────────────────────────────

const mockExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
const mockSleep = vi.fn().mockResolvedValue(undefined);

/** Collect all events from an async generator. */
async function collectEvents(gen: AsyncGenerator<ProvisionEvent>): Promise<ProvisionEvent[]> {
  const events: ProvisionEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Set up standard spies on the adapter's SDK wrapper methods. */
function setupAdapterSpies(adapter: CodespaceAdapter): {
  runBootstrap: ReturnType<typeof vi.fn>;
  runStartPowerLine: ReturnType<typeof vi.fn>;
  openWithFreePort: ReturnType<typeof vi.fn>;
  closeTunnelForEnvironment: ReturnType<typeof vi.fn>;
  registerTunnelForEnvironment: ReturnType<typeof vi.fn>;
} {
  const obj = adapter as unknown as Record<string, unknown>;
  const runBootstrap = vi
    .spyOn(obj, "runBootstrap")
    .mockImplementation(async function* (): AsyncGenerator<ProvisionEvent> {
      yield { stage: "bootstrapping", message: "mock", progress: 0.5 };
    });
  const runStartPowerLine = vi
    .spyOn(obj, "runStartPowerLine")
    .mockResolvedValue({ alreadyRunning: true });
  const openWithFreePort = vi
    .spyOn(obj, "openWithFreePort")
    .mockImplementation(async (action: (port: number) => Promise<unknown>) => action(9999));
  const closeTunnelForEnvironment = vi
    .spyOn(obj, "closeTunnelForEnvironment")
    .mockResolvedValue(undefined);
  const registerTunnelForEnvironment = vi
    .spyOn(obj, "registerTunnelForEnvironment")
    .mockImplementation(() => {});
  return {
    runBootstrap: runBootstrap as unknown as ReturnType<typeof vi.fn>,
    runStartPowerLine: runStartPowerLine as unknown as ReturnType<typeof vi.fn>,
    openWithFreePort: openWithFreePort as unknown as ReturnType<typeof vi.fn>,
    closeTunnelForEnvironment: closeTunnelForEnvironment as unknown as ReturnType<typeof vi.fn>,
    registerTunnelForEnvironment: registerTunnelForEnvironment as unknown as ReturnType<
      typeof vi.fn
    >,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe("CodespaceAdapter.reconnect()", () => {
  let adapter: CodespaceAdapter;
  let spies: ReturnType<typeof setupAdapterSpies>;
  const config = { codespaceName: "test-cs" };
  const token = "test-token";
  const envId = "env-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tunnelInstances.length = 0;
    mocks.tunnelOpenCallCount = 0;
    mocks.tunnelOpenFailOnCall = -1;
    adapter = new CodespaceAdapter({
      exec: mockExec,
      sleep: mockSleep,
    });
    spies = setupAdapterSpies(adapter);
  });

  it("yields reconnecting progress events on happy path", async () => {
    const events = await collectEvents(
      adapter.reconnect!(envId, config as Record<string, unknown>, token),
    );

    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.every((e) => e.stage === "reconnecting")).toBe(true);
    expect(events[events.length - 1]!.message).toContain("Reconnected");
  });

  it("closes stale tunnel, calls startRemotePowerLine with probeFirst and autoDetectWorkspace, and opens new tunnel", async () => {
    await collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token));

    expect(spies.closeTunnelForEnvironment).toHaveBeenCalledWith(envId);
    expect(spies.runStartPowerLine).toHaveBeenCalledOnce();
    // Verify probeFirst and autoDetectWorkspace options (Codespace-specific)
    const options = spies.runStartPowerLine.mock.calls[0]![2];
    expect(options).toMatchObject({ probeFirst: true, autoDetectWorkspace: true });
    expect(spies.registerTunnelForEnvironment).toHaveBeenCalledWith(
      envId,
      expect.objectContaining({
        tunnel: expect.objectContaining({ localPort: 9999 }),
      }),
    );
  });

  it("yields 'restarted' event when PowerLine was not already running", async () => {
    spies.runStartPowerLine.mockResolvedValueOnce({ alreadyRunning: false });

    const events = await collectEvents(
      adapter.reconnect!(envId, config as Record<string, unknown>, token),
    );

    expect(events.some((e) => e.message.includes("restarted"))).toBe(true);
    expect(events[events.length - 1]!.message).toContain("Reconnected");
  });

  it("does not yield 'restarted' event when PowerLine was already running", async () => {
    spies.runStartPowerLine.mockResolvedValueOnce({ alreadyRunning: true });

    const events = await collectEvents(
      adapter.reconnect!(envId, config as Record<string, unknown>, token),
    );

    expect(events.some((e) => e.message.includes("restarted"))).toBe(false);
  });

  it("propagates error when startRemotePowerLine fails", async () => {
    spies.runStartPowerLine.mockRejectedValueOnce(
      new Error("PowerLine process died immediately after starting"),
    );

    await expect(
      collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token)),
    ).rejects.toThrow("PowerLine process died immediately after starting");
  });

  it("propagates error when SSH is unreachable", async () => {
    spies.runStartPowerLine.mockRejectedValueOnce(new Error("ssh connection refused"));

    await expect(
      collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token)),
    ).rejects.toThrow("ssh connection refused");
  });

  it("throws if codespaceName is missing", async () => {
    await expect(
      collectEvents(adapter.reconnect!(envId, {} as Record<string, unknown>, token)),
    ).rejects.toThrow("codespaceName");
  });

  it("closes forward tunnel when reverse tunnel open() fails", async () => {
    mocks.tunnelOpenFailOnCall = 2;

    await expect(
      collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token)),
    ).rejects.toThrow("tunnel open failed");

    expect(mocks.tunnelInstances).toHaveLength(2);
    expect(mocks.tunnelInstances[0]!.close).toHaveBeenCalledOnce();
    expect(spies.registerTunnelForEnvironment).not.toHaveBeenCalled();
  });
});

// ── CodespaceNotFoundError detection ────────────────────────
// These tests go through provision() with the connectivity test exec mock only.
// The runBootstrap spy prevents real I/O after the connectivity test.

describe("CodespaceAdapter — CodespaceNotFoundError detection via provision()", () => {
  let adapter: CodespaceAdapter;
  const config = { codespaceName: "test-cs" };
  const token = "test-token";
  const envId = "env-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tunnelInstances.length = 0;
    mocks.tunnelOpenCallCount = 0;
    mocks.tunnelOpenFailOnCall = -1;
    adapter = new CodespaceAdapter({ exec: mockExec, sleep: mockSleep });
    // Set up spies so provision doesn't try real bootstrap/tunnel work after the connectivity test
    setupAdapterSpies(adapter);
  });

  it("throws CodespaceNotFoundError (FatalAdapterError) when gh stderr contains 'Not Found'", async () => {
    const ghErr = Object.assign(new Error("Command failed: gh codespace ssh"), {
      stderr: "error getting codespace: Not Found",
    });
    mockExec.mockRejectedValueOnce(ghErr);

    const err = await collectEvents(
      adapter.provision(envId, config as Record<string, unknown>, token),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodespaceNotFoundError);
    expect(err).toBeInstanceOf(FatalAdapterError);
    expect((err as Error).message).toContain("test-cs");
  });

  it("throws CodespaceNotFoundError when gh stderr matches 'no such codespace'", async () => {
    const ghErr = Object.assign(new Error("Command failed"), {
      stderr: "no such codespace: test-cs",
    });
    mockExec.mockRejectedValueOnce(ghErr);

    const err = await collectEvents(
      adapter.provision(envId, config as Record<string, unknown>, token),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodespaceNotFoundError);
  });

  it("does NOT throw CodespaceNotFoundError for 'command not found' (false-positive guard)", async () => {
    const bashErr = Object.assign(new Error("Command failed"), {
      stderr: "bash: somebin: command not found",
    });
    mockExec.mockRejectedValueOnce(bashErr);

    const err = await collectEvents(
      adapter.provision(envId, config as Record<string, unknown>, token),
    ).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(CodespaceNotFoundError);
    expect(err).not.toBeInstanceOf(FatalAdapterError);
  });

  it("throws CodespaceNotFoundError when gh reports 'does not exist'", async () => {
    const ghErr = Object.assign(new Error("Command failed"), {
      stderr: "The codespace 'test-cs' does not exist",
    });
    mockExec.mockRejectedValueOnce(ghErr);

    const err = await collectEvents(
      adapter.provision(envId, config as Record<string, unknown>, token),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodespaceNotFoundError);
  });

  it("throws CodespaceNotFoundError for real gh HTTP 404 response (getting full codespace details)", async () => {
    const ghErr = Object.assign(new Error("Command failed: gh codespace ssh"), {
      stderr:
        "getting full codespace details: HTTP 404: Not Found (https://api.github.com/user/codespaces/fake-cs)",
    });
    mockExec.mockRejectedValueOnce(ghErr);

    const err = await collectEvents(
      adapter.provision(envId, config as Record<string, unknown>, token),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodespaceNotFoundError);
    expect(err).toBeInstanceOf(FatalAdapterError);
  });

  it("does NOT throw CodespaceNotFoundError for generic SSH failures", async () => {
    const sshErr = Object.assign(new Error("Command failed: gh codespace ssh"), {
      stderr: "ssh: connect to host 127.0.0.1 port 22: Connection refused",
    });
    mockExec.mockRejectedValueOnce(sshErr);

    const err = await collectEvents(
      adapter.provision(envId, config as Record<string, unknown>, token),
    ).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(CodespaceNotFoundError);
    expect(err).not.toBeInstanceOf(FatalAdapterError);
  });
});

// ── Tunnel leak tests for provision ────────────────────────

describe("CodespaceAdapter.provision() — tunnel cleanup", () => {
  let adapter: CodespaceAdapter;
  let spies: ReturnType<typeof setupAdapterSpies>;
  const config = { codespaceName: "test-cs" };
  const token = "test-token";
  const envId = "env-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tunnelInstances.length = 0;
    mocks.tunnelOpenCallCount = 0;
    mocks.tunnelOpenFailOnCall = -1;
    adapter = new CodespaceAdapter({ exec: mockExec, sleep: mockSleep });
    spies = setupAdapterSpies(adapter);
  });

  it("closes forward tunnel when reverse tunnel open() fails", async () => {
    mocks.tunnelOpenFailOnCall = 2;

    await expect(
      collectEvents(adapter.provision(envId, config as Record<string, unknown>, token)),
    ).rejects.toThrow("tunnel open failed");

    expect(mocks.tunnelInstances).toHaveLength(2);
    expect(mocks.tunnelInstances[0]!.close).toHaveBeenCalledOnce();
    expect(spies.registerTunnelForEnvironment).not.toHaveBeenCalled();
  });
});
