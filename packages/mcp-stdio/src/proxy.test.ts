import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { newTransport, withReconnect } from "./proxy.js";
import type { ClientManager } from "./proxy.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

describe("newTransport", () => {
  it("sets Authorization header with Bearer token", () => {
    const transport = newTransport("http://127.0.0.1:7435/mcp", "test-key-abc");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const init = (transport as any)._requestInit as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["Authorization"]).toBe("Bearer test-key-abc");
  });

  it("uses the provided URL", () => {
    const transport = newTransport("http://myhost:9000/mcp", "key");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (transport as any)._url as URL | undefined;
    expect(url?.toString()).toBe("http://myhost:9000/mcp");
  });
});

describe("withReconnect", () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeManager(client: Client): ClientManager & { getClient: Mock; resetClient: Mock } {
    return {
      getClient: vi.fn().mockResolvedValue(client),
      resetClient: vi.fn(),
    };
  }

  it("calls fn once when it succeeds", async () => {
    const client = {} as Client;
    const manager = makeManager(client);
    const fn: Mock = vi.fn().mockResolvedValue("result");

    const result = await withReconnect(manager, fn);

    expect(result).toBe("result");
    expect(manager.getClient).toHaveBeenCalledTimes(1);
    expect(manager.resetClient).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resets and retries once on failure", async () => {
    const client = {} as Client;
    const manager = makeManager(client);
    const fn: Mock = vi.fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValue("recovered");

    const result = await withReconnect(manager, fn);

    expect(result).toBe("recovered");
    expect(manager.getClient).toHaveBeenCalledTimes(2);
    expect(manager.resetClient).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("propagates error if retry also fails", async () => {
    const client = {} as Client;
    const manager = makeManager(client);
    const fn: Mock = vi.fn().mockRejectedValue(new Error("still broken"));

    await expect(withReconnect(manager, fn)).rejects.toThrow("still broken");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
