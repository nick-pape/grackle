import { describe, it, expect, vi } from "vitest";
import { LocalAdapter } from "./local.js";

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
      client: { ping: vi.fn().mockRejectedValue(new Error("unreachable")) },
      environmentId: "local",
      port: 7433,
    };
    const result = await adapter.healthCheck(connection as never);
    expect(result).toBe(false);
  });

  it("healthCheck returns true when ping succeeds", async () => {
    const adapter = new LocalAdapter();
    const connection = {
      client: { ping: vi.fn().mockResolvedValue({}) },
      environmentId: "local",
      port: 7433,
    };
    const result = await adapter.healthCheck(connection as never);
    expect(result).toBe(true);
  });
});
