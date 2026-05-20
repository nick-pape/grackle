import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { newTransport, withReconnect, isTransportError } from "./proxy.js";
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

describe("isTransportError", () => {
  it("recognises TypeError as a transport error", () => {
    expect(isTransportError(new TypeError("fetch failed"))).toBe(true);
  });

  it("recognises ECONNREFUSED as a transport error", () => {
    expect(isTransportError(new Error("connect ECONNREFUSED 127.0.0.1:7435"))).toBe(true);
  });

  it("recognises ECONNRESET as a transport error", () => {
    expect(isTransportError(new Error("read ECONNRESET"))).toBe(true);
  });

  it("does not classify tool / application errors as transport errors", () => {
    expect(isTransportError(new Error("tool execution failed"))).toBe(false);
    expect(isTransportError(new Error("invalid arguments"))).toBe(false);
    expect(isTransportError("string error")).toBe(false);
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

  it("resets and retries once on transport error", async () => {
    const client = {} as Client;
    const manager = makeManager(client);
    const fn: Mock = vi.fn()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:7435"))
      .mockResolvedValue("recovered");

    const result = await withReconnect(manager, fn);

    expect(result).toBe("recovered");
    expect(manager.getClient).toHaveBeenCalledTimes(2);
    expect(manager.resetClient).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-transport errors", async () => {
    const client = {} as Client;
    const manager = makeManager(client);
    const fn: Mock = vi.fn().mockRejectedValue(new Error("tool execution failed"));

    await expect(withReconnect(manager, fn)).rejects.toThrow("tool execution failed");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(manager.resetClient).not.toHaveBeenCalled();
  });

  it("propagates error if retry also fails", async () => {
    const client = {} as Client;
    const manager = makeManager(client);
    const transportError = new Error("connect ECONNREFUSED 127.0.0.1:7435");
    const fn: Mock = vi.fn().mockRejectedValue(transportError);

    await expect(withReconnect(manager, fn)).rejects.toThrow("ECONNREFUSED");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
