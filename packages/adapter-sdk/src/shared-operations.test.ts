import { describe, it, expect, vi, beforeEach } from "vitest";

import { TunnelRegistry } from "./tunnel-registry.js";
import { remoteHealthCheck } from "./shared-operations.js";
import type { PowerLineConnection } from "./adapter.js";

// ── Mock helpers ─────────────────────────────────────────────

function createMockTunnel(alive: boolean) {
  return {
    isAlive: vi.fn().mockReturnValue(alive),
    localPort: 12345,
    open: vi.fn(),
    close: vi.fn(),
  };
}

function createMockConnection(pingFn?: () => Promise<unknown>): PowerLineConnection {
  return {
    environmentId: "env-1",
    port: 12345,
    ping: pingFn ? vi.fn().mockImplementation(pingFn) : vi.fn().mockResolvedValue(undefined),
    transport: {} as PowerLineConnection["transport"],
  };
}

// ── Tests ───────────────────────────────────────────────────

let registry: TunnelRegistry;

beforeEach(() => {
  vi.clearAllMocks();
  registry = new TunnelRegistry();
});

describe("remoteHealthCheck", () => {
  it("returns false when no tunnel state is registered", async () => {
    const conn = createMockConnection();
    await expect(remoteHealthCheck(conn, registry)).resolves.toBe(false);
    expect(conn.ping).not.toHaveBeenCalled();
  });

  it("returns false when the forward tunnel is dead", async () => {
    registry.register("env-1", { tunnel: createMockTunnel(false) });
    const conn = createMockConnection();
    await expect(remoteHealthCheck(conn, registry)).resolves.toBe(false);
    expect(conn.ping).not.toHaveBeenCalled();
  });

  it("returns false when the reverse tunnel is dead but the forward tunnel is alive", async () => {
    registry.register("env-1", {
      tunnel: createMockTunnel(true),
      reverseTunnel: createMockTunnel(false),
    });
    const conn = createMockConnection();
    await expect(remoteHealthCheck(conn, registry)).resolves.toBe(false);
    expect(conn.ping).not.toHaveBeenCalled();
  });

  it("returns true when both tunnels are alive and ping succeeds", async () => {
    registry.register("env-1", {
      tunnel: createMockTunnel(true),
      reverseTunnel: createMockTunnel(true),
    });
    const conn = createMockConnection();
    await expect(remoteHealthCheck(conn, registry)).resolves.toBe(true);
    expect(conn.ping).toHaveBeenCalledOnce();
  });

  it("returns true when no reverse tunnel is registered (local/docker adapters)", async () => {
    registry.register("env-1", { tunnel: createMockTunnel(true) });
    const conn = createMockConnection();
    await expect(remoteHealthCheck(conn, registry)).resolves.toBe(true);
    expect(conn.ping).toHaveBeenCalledOnce();
  });

  it("returns false when both tunnels are alive but ping throws", async () => {
    registry.register("env-1", {
      tunnel: createMockTunnel(true),
      reverseTunnel: createMockTunnel(true),
    });
    const conn = createMockConnection(() => Promise.reject(new Error("ECONNREFUSED")));
    await expect(remoteHealthCheck(conn, registry)).resolves.toBe(false);
  });

  it("returns false when forward tunnel is alive but ping throws (no reverse tunnel)", async () => {
    registry.register("env-1", { tunnel: createMockTunnel(true) });
    const conn = createMockConnection(() => Promise.reject(new Error("timeout")));
    await expect(remoteHealthCheck(conn, registry)).resolves.toBe(false);
  });
});
