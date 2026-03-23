import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProvisionEvent } from "@grackle-ai/adapter-sdk";

// ── Mock adapter-sdk (tunnel/process functions that can't be DI'd) ──
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
    // Stub ProcessTunnel so CodespaceTunnel doesn't spawn real processes (tested in tunnel.test.ts)
    ProcessTunnel: class {
      public localPort: number;
      public constructor(localPort: number) { this.localPort = localPort; }
      public async open(): Promise<void> { /* no-op */ }
      public async close(): Promise<void> { /* no-op */ }
      public isAlive(): boolean { return true; }
    },
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

// ── Tests ───────────────────────────────────────────────────

describe("CodespaceAdapter.reconnect()", () => {
  let adapter: CodespaceAdapter;
  const config = { codespaceName: "test-cs" };
  const token = "test-token";
  const envId = "env-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startRemotePowerLine.mockResolvedValue({ alreadyRunning: true });
    adapter = new CodespaceAdapter({
      exec: mockExec,
      sleep: mockSleep,
    });
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
    // Verify probeFirst and autoDetectWorkspace options
    const options = mocks.startRemotePowerLine.mock.calls[0][2];
    expect(options).toMatchObject({ probeFirst: true, autoDetectWorkspace: true });
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

  it("throws if codespaceName is missing", async () => {
    await expect(collectEvents(adapter.reconnect!(envId, {} as Record<string, unknown>, token)))
      .rejects.toThrow("codespaceName");
  });
});
