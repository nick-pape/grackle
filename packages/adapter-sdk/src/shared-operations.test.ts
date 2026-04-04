import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the tunnel-registry so we can control what getTunnel returns
vi.mock("./tunnel-registry.js", () => ({
  getTunnel: vi.fn(),
  closeTunnel: vi.fn().mockResolvedValue(undefined),
}));

import { getTunnel } from "./tunnel-registry.js";
import { remoteHealthCheck } from "./shared-operations.js";
import type { PowerLineConnection } from "./adapter.js";

// ── Mock helpers ─────────────────────────────────────────────

function createMockTunnel(alive: boolean) {
  return { isAlive: vi.fn().mockReturnValue(alive), localPort: 12345, open: vi.fn(), close: vi.fn() };
}

function createMockConnection(pingFn?: () => Promise<unknown>): PowerLineConnection {
  return {
    environmentId: "env-1",
    port: 12345,
    client: {
      ping: pingFn ? vi.fn().mockImplementation(pingFn) : vi.fn().mockResolvedValue({}),
    } as unknown as PowerLineConnection["client"],
  };
}

// ── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("remoteHealthCheck", () => {
  it("returns false when no tunnel state is registered", async () => {
    vi.mocked(getTunnel).mockReturnValue(undefined);
    const conn = createMockConnection();
    await expect(remoteHealthCheck(conn)).resolves.toBe(false);
    expect(conn.client.ping).not.toHaveBeenCalled();
  });

  it("returns false when the forward tunnel is dead", async () => {
    vi.mocked(getTunnel).mockReturnValue({
      tunnel: createMockTunnel(false),
    });
    const conn = createMockConnection();
    await expect(remoteHealthCheck(conn)).resolves.toBe(false);
    expect(conn.client.ping).not.toHaveBeenCalled();
  });

  it("returns false when the reverse tunnel is dead but the forward tunnel is alive", async () => {
    vi.mocked(getTunnel).mockReturnValue({
      tunnel: createMockTunnel(true),
      reverseTunnel: createMockTunnel(false),
    });
    const conn = createMockConnection();
    await expect(remoteHealthCheck(conn)).resolves.toBe(false);
    expect(conn.client.ping).not.toHaveBeenCalled();
  });

  it("returns true when both tunnels are alive and ping succeeds", async () => {
    vi.mocked(getTunnel).mockReturnValue({
      tunnel: createMockTunnel(true),
      reverseTunnel: createMockTunnel(true),
    });
    const conn = createMockConnection();
    await expect(remoteHealthCheck(conn)).resolves.toBe(true);
    expect(conn.client.ping).toHaveBeenCalledOnce();
  });

  it("returns true when no reverse tunnel is registered (local/docker adapters)", async () => {
    vi.mocked(getTunnel).mockReturnValue({
      tunnel: createMockTunnel(true),
      // no reverseTunnel
    });
    const conn = createMockConnection();
    await expect(remoteHealthCheck(conn)).resolves.toBe(true);
    expect(conn.client.ping).toHaveBeenCalledOnce();
  });

  it("returns false when both tunnels are alive but ping throws", async () => {
    vi.mocked(getTunnel).mockReturnValue({
      tunnel: createMockTunnel(true),
      reverseTunnel: createMockTunnel(true),
    });
    const conn = createMockConnection(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(remoteHealthCheck(conn)).resolves.toBe(false);
  });

  it("returns false when forward tunnel is alive but ping throws (no reverse tunnel)", async () => {
    vi.mocked(getTunnel).mockReturnValue({
      tunnel: createMockTunnel(true),
    });
    const conn = createMockConnection(() => Promise.reject(new Error("timeout")));
    await expect(remoteHealthCheck(conn)).resolves.toBe(false);
  });
});
