import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProvisionEvent } from "@grackle-ai/adapter-sdk";

// ── Mock adapter-sdk (tunnel/process functions that can't be DI'd) ──
interface MockTunnelInstance {
  localPort: number;
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  closeTunnel: vi.fn().mockResolvedValue(undefined),
  registerTunnel: vi.fn(),
  findFreePort: vi.fn().mockResolvedValue(9999),
  startRemotePowerLine: vi.fn().mockResolvedValue({ alreadyRunning: true }),
  bootstrapPowerLine: vi.fn(),
  tunnelInstances: [] as MockTunnelInstance[],
  tunnelOpenCallCount: 0,
  tunnelOpenFailOnCall: -1,
}));

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@grackle-ai/adapter-sdk")>();
  return {
    ...original,
    closeTunnel: mocks.closeTunnel,
    registerTunnel: mocks.registerTunnel,
    findFreePort: mocks.findFreePort,
    startRemotePowerLine: mocks.startRemotePowerLine,
    bootstrapPowerLine: async function* () {
      yield { stage: "bootstrapping", message: "mock", progress: 0.5 };
    },
    // Stub ProcessTunnel so SshTunnel doesn't spawn real processes (tested in tunnel.test.ts)
    ProcessTunnel: class {
      public localPort: number;
      public close = vi.fn();
      public open = vi.fn().mockImplementation(async () => {
        mocks.tunnelOpenCallCount++;
        if (mocks.tunnelOpenCallCount === mocks.tunnelOpenFailOnCall) {
          throw new Error("tunnel open failed");
        }
      });
      public isAlive = vi.fn().mockReturnValue(true);
      public constructor(localPort: number) {
        this.localPort = localPort;
        mocks.tunnelInstances.push(this as unknown as MockTunnelInstance);
      }
    },
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

// ── Tests ───────────────────────────────────────────────────

describe("SshAdapter.reconnect()", () => {
  let adapter: SshAdapter;
  const config = { host: "example.com" };
  const token = "test-token";
  const envId = "env-ssh-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tunnelInstances.length = 0;
    mocks.tunnelOpenCallCount = 0;
    mocks.tunnelOpenFailOnCall = -1;
    mocks.startRemotePowerLine.mockResolvedValue({ alreadyRunning: true });
    adapter = new SshAdapter({
      exec: mockExec,
      sleep: mockSleep,
    });
  });

  it("yields reconnecting progress events on happy path", async () => {
    const events = await collectEvents(
      adapter.reconnect!(envId, config as Record<string, unknown>, token),
    );

    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.every((e) => e.stage === "reconnecting")).toBe(true);
    expect(events[events.length - 1].message).toContain("Reconnected");
  });

  it("closes stale tunnel, calls startRemotePowerLine with probeFirst, and opens new tunnel", async () => {
    await collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token));

    expect(mocks.closeTunnel).toHaveBeenCalledWith(envId);
    expect(mocks.startRemotePowerLine).toHaveBeenCalledOnce();
    // Verify probeFirst option (SSH adapter does NOT set autoDetectWorkspace)
    const options = mocks.startRemotePowerLine.mock.calls[0][2];
    expect(options).toMatchObject({ probeFirst: true });
    expect(options.autoDetectWorkspace).toBeUndefined();
    expect(mocks.registerTunnel).toHaveBeenCalledWith(
      envId,
      expect.objectContaining({
        tunnel: expect.objectContaining({ localPort: 9999 }),
      }),
    );
  });

  it("yields 'restarted' event when PowerLine was not already running", async () => {
    mocks.startRemotePowerLine.mockResolvedValueOnce({ alreadyRunning: false });

    const events = await collectEvents(
      adapter.reconnect!(envId, config as Record<string, unknown>, token),
    );

    expect(events.some((e) => e.message.includes("restarted"))).toBe(true);
    expect(events[events.length - 1].message).toContain("Reconnected");
  });

  it("does not yield 'restarted' event when PowerLine was already running", async () => {
    mocks.startRemotePowerLine.mockResolvedValueOnce({ alreadyRunning: true });

    const events = await collectEvents(
      adapter.reconnect!(envId, config as Record<string, unknown>, token),
    );

    expect(events.some((e) => e.message.includes("restarted"))).toBe(false);
  });

  it("propagates error when startRemotePowerLine fails", async () => {
    mocks.startRemotePowerLine.mockRejectedValueOnce(
      new Error("PowerLine process died immediately after starting"),
    );

    await expect(
      collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token)),
    ).rejects.toThrow("PowerLine process died immediately after starting");
  });

  it("propagates error when SSH is unreachable", async () => {
    mocks.startRemotePowerLine.mockRejectedValueOnce(new Error("ssh connection refused"));

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

    const options = mocks.startRemotePowerLine.mock.calls[0][2];
    expect(options.extraEnv).toEqual({ MY_VAR: "value" });
  });

  it("closes forward tunnel when reverse tunnel open() fails", async () => {
    mocks.tunnelOpenFailOnCall = 2;

    await expect(
      collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token)),
    ).rejects.toThrow("tunnel open failed");

    expect(mocks.tunnelInstances).toHaveLength(2);
    expect(mocks.tunnelInstances[0]!.close).toHaveBeenCalledOnce();
    expect(mocks.registerTunnel).not.toHaveBeenCalled();
  });
});

// ── Tunnel leak tests for provision ────────────────────────

describe("SshAdapter.provision() — tunnel cleanup", () => {
  let adapter: SshAdapter;
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
  });

  it("closes forward tunnel when reverse tunnel open() fails", async () => {
    mocks.tunnelOpenFailOnCall = 2;

    await expect(
      collectEvents(adapter.provision(envId, config as Record<string, unknown>, token)),
    ).rejects.toThrow("tunnel open failed");

    expect(mocks.tunnelInstances).toHaveLength(2);
    expect(mocks.tunnelInstances[0]!.close).toHaveBeenCalledOnce();
    expect(mocks.registerTunnel).not.toHaveBeenCalled();
  });
});
