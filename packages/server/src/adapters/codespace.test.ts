import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProvisionEvent } from "./adapter.js";

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

// ── Mock remote-adapter-utils ───────────────────────────────
const mocks = vi.hoisted(() => ({
  closeTunnel: vi.fn().mockResolvedValue(undefined),
  registerTunnel: vi.fn(),
  findFreePort: vi.fn().mockResolvedValue(9999),
  probeRemotePowerLine: vi.fn().mockResolvedValue(undefined),
  writeRemoteEnvFile: vi.fn().mockResolvedValue(undefined),
  startRemotePowerLine: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./remote-adapter-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./remote-adapter-utils.js")>();
  return {
    ...original,
    closeTunnel: mocks.closeTunnel,
    registerTunnel: mocks.registerTunnel,
    findFreePort: mocks.findFreePort,
    probeRemotePowerLine: mocks.probeRemotePowerLine,
    writeRemoteEnvFile: mocks.writeRemoteEnvFile,
    startRemotePowerLine: mocks.startRemotePowerLine,
    // Stub ProcessTunnel so CodespaceTunnel doesn't spawn real processes
    ProcessTunnel: class {
      public localPort: number;
      public constructor(localPort: number) { this.localPort = localPort; }
      public async open(): Promise<void> { /* no-op */ }
      public async close(): Promise<void> { /* no-op */ }
      public isAlive(): boolean { return true; }
    },
    SSH_CONNECTIVITY_TIMEOUT_MS: 15_000,
    REMOTE_EXEC_DEFAULT_TIMEOUT_MS: 60_000,
  };
});

import { CodespaceAdapter } from "./codespace.js";

// ── Helper ──────────────────────────────────────────────────

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
    adapter = new CodespaceAdapter();
  });

  it("yields reconnecting progress events on happy path", async () => {
    const events = await collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token));

    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.every((e) => e.stage === "reconnecting")).toBe(true);
    expect(events[events.length - 1].message).toContain("Reconnected");
  });

  it("closes stale tunnel, probes PowerLine, and opens new tunnel", async () => {
    await collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token));

    expect(mocks.closeTunnel).toHaveBeenCalledWith(envId);
    expect(mocks.probeRemotePowerLine).toHaveBeenCalledOnce();
    expect(mocks.writeRemoteEnvFile).toHaveBeenCalledOnce();
    expect(mocks.registerTunnel).toHaveBeenCalledWith(envId, expect.objectContaining({
      tunnel: expect.objectContaining({ localPort: 9999 }),
    }));
  });

  it("restarts PowerLine when probe fails (does not throw)", async () => {
    mocks.probeRemotePowerLine.mockRejectedValueOnce(new Error("port not listening"));

    const events = await collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token));

    // Should have called startRemotePowerLine as restart
    expect(mocks.startRemotePowerLine).toHaveBeenCalledOnce();
    // Should still complete successfully
    expect(events[events.length - 1].message).toContain("Reconnected");
    // Should have a "restarting" event
    expect(events.some((e) => e.message.includes("restarting"))).toBe(true);
  });

  it("propagates error when probe fails AND restart fails", async () => {
    mocks.probeRemotePowerLine.mockRejectedValueOnce(new Error("port not listening"));
    mocks.startRemotePowerLine.mockRejectedValueOnce(
      new Error("PowerLine process died immediately after starting"),
    );

    await expect(collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token)))
      .rejects.toThrow("PowerLine process died immediately after starting");
  });

  it("propagates error when SSH is unreachable", async () => {
    mockExec.mockRejectedValueOnce(new Error("ssh connection refused"));

    await expect(collectEvents(adapter.reconnect!(envId, config as Record<string, unknown>, token)))
      .rejects.toThrow("ssh connection refused");
  });

  it("throws if codespaceName is missing", async () => {
    await expect(collectEvents(adapter.reconnect!(envId, {} as Record<string, unknown>, token)))
      .rejects.toThrow("codespaceName");
  });
});
