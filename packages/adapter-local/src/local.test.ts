import { describe, it, expect, vi } from "vitest";
import { LocalAdapter } from "./local.js";

// Mock `@grackle-ai/adapter-sdk`'s createAhpHostTransport so we can exercise
// LocalAdapter.connect() without an actual PowerLine. The factory below is
// rebound per-test via vi.mocked() so we can drive ping success/failure.
vi.mock("@grackle-ai/adapter-sdk", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@grackle-ai/adapter-sdk");
  return {
    ...actual,
    createAhpHostTransport: vi.fn(),
    sleep: async () => {},
  };
});

const { createAhpHostTransport } = await import("@grackle-ai/adapter-sdk");

describe("LocalAdapter", () => {
  it("has type 'local'", () => {
    const adapter = new LocalAdapter();
    expect(adapter.type).toBe("local");
  });

  it("accepts injected sleep dependency", () => {
    const mockSleep = vi.fn().mockResolvedValue(undefined);
    const adapter = new LocalAdapter({ sleep: mockSleep });
    expect(adapter.type).toBe("local");
  });

  it("healthCheck returns false when ping fails", async () => {
    const adapter = new LocalAdapter();
    const connection = {
      ping: vi.fn().mockRejectedValue(new Error("unreachable")),
      close: vi.fn(async () => {}),
      environmentId: "local",
      port: 7433,
    };
    const result = await adapter.healthCheck(connection as never);
    expect(result).toBe(false);
  });

  it("healthCheck returns true when ping succeeds", async () => {
    const adapter = new LocalAdapter();
    const connection = {
      ping: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(async () => {}),
      environmentId: "local",
      port: 7433,
    };
    const result = await adapter.healthCheck(connection as never);
    expect(result).toBe(true);
  });

  it("connect returns a usable PowerLineConnection on success", async () => {
    const close = vi.fn(async () => {});
    const request = vi.fn(async () => null);
    vi.mocked(createAhpHostTransport).mockResolvedValueOnce({
      transport: {} as never,
      socket: { close, request } as never,
    });
    const adapter = new LocalAdapter();
    const conn = await adapter.connect("env-1", { port: 7433 }, "tok");
    expect(conn.environmentId).toBe("env-1");
    expect(conn.port).toBe(7433);
    await conn.ping();
    expect(request).toHaveBeenCalledWith("ping", { channel: "ahp-root://" });
  });

  it("connect closes the socket and rethrows when the ping probe fails", async () => {
    const close = vi.fn(async () => {});
    const pingErr = new Error("probe failed");
    const request = vi.fn(async () => {
      throw pingErr;
    });
    vi.mocked(createAhpHostTransport).mockResolvedValueOnce({
      transport: {} as never,
      socket: { close, request } as never,
    });
    const adapter = new LocalAdapter();
    await expect(adapter.connect("env-2", {}, "tok")).rejects.toBe(pingErr);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("connect tolerates a socket whose close() rejects after a ping failure", async () => {
    const close = vi.fn(async () => {
      throw new Error("close failed");
    });
    const pingErr = new Error("probe failed");
    const request = vi.fn(async () => {
      throw pingErr;
    });
    vi.mocked(createAhpHostTransport).mockResolvedValueOnce({
      transport: {} as never,
      socket: { close, request } as never,
    });
    const adapter = new LocalAdapter();
    // Close-failure is swallowed; the original ping error is the one that
    // propagates so the caller can decide what to do (retry, give up, ...).
    await expect(adapter.connect("env-3", {}, "tok")).rejects.toBe(pingErr);
  });
});
