import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProvisionEvent } from "@grackle-ai/adapter-sdk";

// ── Mock logger ─────────────────────────────────────────────
vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock exec utility ───────────────────────────────────────
const mockExec = vi.hoisted(() => vi.fn().mockResolvedValue({ stdout: "", stderr: "" }));
vi.mock("../utils/exec.js", () => ({
  exec: mockExec,
}));

// ── Mock sleep (used by SshReverseTunnel.waitForReady) ──────
vi.mock("../utils/sleep.js", () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock remote-adapter-utils ───────────────────────────────
const mocks = vi.hoisted(() => ({
  closeTunnel: vi.fn().mockResolvedValue(undefined),
  registerTunnel: vi.fn(),
  findFreePort: vi.fn().mockResolvedValue(9999),
  startRemotePowerLine: vi.fn().mockResolvedValue({ alreadyRunning: true }),
}));

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@grackle-ai/adapter-sdk")>();
  return {
    ...original,
    closeTunnel: mocks.closeTunnel,
    registerTunnel: mocks.registerTunnel,
    findFreePort: mocks.findFreePort,
    startRemotePowerLine: mocks.startRemotePowerLine,
    // Stub ProcessTunnel so SshTunnel doesn't spawn real processes (tested in tunnel.test.ts)
    ProcessTunnel: class {
      public localPort: number;
      public constructor(localPort: number) { this.localPort = localPort; }
      public async open(): Promise<void> { /* no-op */ }
      public async close(): Promise<void> { /* no-op */ }
      public isAlive(): boolean { return true; }
    },
  };
});

import { SshAdapter } from "./ssh.js";

// ── Helpers ─────────────────────────────────────────────────

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
    mocks.startRemotePowerLine.mockResolvedValue({ alreadyRunning: true });
    adapter = new SshAdapter();
  });

  it("yields reconnecting progress events on happy path", async () => {
    const events = await collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token));

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
    expect(mocks.registerTunnel).toHaveBeenCalledWith(envId, expect.objectContaining({
      tunnel: expect.objectContaining({ localPort: 9999 }),
    }));
  });

  it("yields 'restarted' event when PowerLine was not already running", async () => {
    mocks.startRemotePowerLine.mockResolvedValueOnce({ alreadyRunning: false });

    const events = await collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token));

    expect(events.some((e) => e.message.includes("restarted"))).toBe(true);
    expect(events[events.length - 1].message).toContain("Reconnected");
  });

  it("does not yield 'restarted' event when PowerLine was already running", async () => {
    mocks.startRemotePowerLine.mockResolvedValueOnce({ alreadyRunning: true });

    const events = await collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token));

    expect(events.some((e) => e.message.includes("restarted"))).toBe(false);
  });

  it("propagates error when startRemotePowerLine fails", async () => {
    mocks.startRemotePowerLine.mockRejectedValueOnce(
      new Error("PowerLine process died immediately after starting"),
    );

    await expect(collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token)))
      .rejects.toThrow("PowerLine process died immediately after starting");
  });

  it("propagates error when SSH is unreachable", async () => {
    mocks.startRemotePowerLine.mockRejectedValueOnce(new Error("ssh connection refused"));

    await expect(collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token)))
      .rejects.toThrow("ssh connection refused");
  });

  it("throws if host is missing", async () => {
    await expect(collectEvents(adapter.reconnect!(envId, {} as Record<string, unknown>, token)))
      .rejects.toThrow("host");
  });

  it("forwards extraEnv from config", async () => {
    const cfgWithEnv = { host: "example.com", env: { MY_VAR: "value" } };
    await collectEvents(adapter.reconnect!(envId, cfgWithEnv as Record<string, unknown>, token));

    const options = mocks.startRemotePowerLine.mock.calls[0][2];
    expect(options.extraEnv).toEqual({ MY_VAR: "value" });
  });
});
