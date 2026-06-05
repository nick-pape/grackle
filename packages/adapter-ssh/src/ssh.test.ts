import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProvisionEvent } from "@grackle-ai/adapter-sdk";

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

import { SshAdapter } from "./ssh.js";

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
function setupAdapterSpies(adapter: SshAdapter): {
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

describe("SshAdapter.reconnect()", () => {
  let adapter: SshAdapter;
  let spies: ReturnType<typeof setupAdapterSpies>;
  const config = { host: "example.com" };
  const token = "test-token";
  const envId = "env-ssh-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tunnelInstances.length = 0;
    mocks.tunnelOpenCallCount = 0;
    mocks.tunnelOpenFailOnCall = -1;
    adapter = new SshAdapter({
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

  it("closes stale tunnel, calls startRemotePowerLine with probeFirst, and opens new tunnel", async () => {
    await collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token));

    expect(spies.closeTunnelForEnvironment).toHaveBeenCalledWith(envId);
    expect(spies.runStartPowerLine).toHaveBeenCalledOnce();
    // Verify probeFirst option (SSH adapter does NOT set autoDetectWorkspace)
    const options = spies.runStartPowerLine.mock.calls[0]![2];
    expect(options).toMatchObject({ probeFirst: true });
    expect(options.autoDetectWorkspace).toBeUndefined();
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

  it("throws if host is missing", async () => {
    await expect(
      collectEvents(adapter.reconnect!(envId, {} as Record<string, unknown>, token)),
    ).rejects.toThrow("host");
  });

  it("forwards extraEnv from config", async () => {
    const cfgWithEnv = { host: "example.com", env: { MY_VAR: "value" } };
    await collectEvents(adapter.reconnect!(envId, cfgWithEnv as Record<string, unknown>, token));

    const options = spies.runStartPowerLine.mock.calls[0]![2];
    expect(options.extraEnv).toEqual({ MY_VAR: "value" });
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

// ── Tunnel leak tests for provision ────────────────────────

describe("SshAdapter.provision() — tunnel cleanup", () => {
  let adapter: SshAdapter;
  let spies: ReturnType<typeof setupAdapterSpies>;
  const config = { host: "example.com" };
  const token = "test-token";
  const envId = "env-ssh-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tunnelInstances.length = 0;
    mocks.tunnelOpenCallCount = 0;
    mocks.tunnelOpenFailOnCall = -1;
    adapter = new SshAdapter({
      exec: mockExec,
      sleep: mockSleep,
    });
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
