import { describe, it, expect, vi, beforeEach } from "vitest";
import { TunnelRegistry } from "./tunnel-registry.js";
import type { RemoteTunnel } from "./tunnel.js";

function createMockTunnel(): RemoteTunnel {
  return {
    localPort: 12345,
    isAlive: vi.fn().mockReturnValue(true),
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("TunnelRegistry", () => {
  let registry: TunnelRegistry;

  beforeEach(() => {
    registry = new TunnelRegistry();
  });

  it("register() stores state retrievable via get()", () => {
    const tunnel = createMockTunnel();
    registry.register("env-1", { tunnel });
    expect(registry.get("env-1")).toEqual({ tunnel });
  });

  it("get() returns undefined for unregistered IDs", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("register() closes existing tunnel when replacing", () => {
    const oldTunnel = createMockTunnel();
    const newTunnel = createMockTunnel();
    registry.register("env-1", { tunnel: oldTunnel });
    registry.register("env-1", { tunnel: newTunnel });

    expect(oldTunnel.close).toHaveBeenCalledOnce();
    expect(registry.get("env-1")!.tunnel).toBe(newTunnel);
  });

  it("register() closes existing reverse tunnel when replacing", () => {
    const oldTunnel = createMockTunnel();
    const oldReverse = createMockTunnel();
    const newTunnel = createMockTunnel();
    registry.register("env-1", { tunnel: oldTunnel, reverseTunnel: oldReverse });
    registry.register("env-1", { tunnel: newTunnel });

    expect(oldTunnel.close).toHaveBeenCalledOnce();
    expect(oldReverse.close).toHaveBeenCalledOnce();
  });

  it("close() closes both tunnels and removes from registry", async () => {
    const tunnel = createMockTunnel();
    const reverse = createMockTunnel();
    registry.register("env-1", { tunnel, reverseTunnel: reverse });

    await registry.close("env-1");

    expect(tunnel.close).toHaveBeenCalledOnce();
    expect(reverse.close).toHaveBeenCalledOnce();
    expect(registry.get("env-1")).toBeUndefined();
  });

  it("close() is a no-op for unknown IDs", async () => {
    await expect(registry.close("nonexistent")).resolves.toBeUndefined();
  });

  it("closeAll() closes all registered tunnels", async () => {
    const t1 = createMockTunnel();
    const t2 = createMockTunnel();
    registry.register("env-1", { tunnel: t1 });
    registry.register("env-2", { tunnel: t2 });

    await registry.closeAll();

    expect(t1.close).toHaveBeenCalledOnce();
    expect(t2.close).toHaveBeenCalledOnce();
    expect(registry.get("env-1")).toBeUndefined();
    expect(registry.get("env-2")).toBeUndefined();
  });

  it("closeAll() logs errors but continues on individual failures", async () => {
    const t1 = createMockTunnel();
    t1.close = vi.fn().mockRejectedValue(new Error("close failed"));
    const t2 = createMockTunnel();
    registry.register("env-1", { tunnel: t1 });
    registry.register("env-2", { tunnel: t2 });

    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await registry.closeAll(mockLogger);

    expect(mockLogger.error).toHaveBeenCalledOnce();
    expect(t2.close).toHaveBeenCalledOnce();
    expect(registry.get("env-2")).toBeUndefined();
  });

  it("instances are isolated from each other", () => {
    const r1 = new TunnelRegistry();
    const r2 = new TunnelRegistry();
    const tunnel = createMockTunnel();

    r1.register("env-1", { tunnel });

    expect(r1.get("env-1")).toBeDefined();
    expect(r2.get("env-1")).toBeUndefined();
  });
});
