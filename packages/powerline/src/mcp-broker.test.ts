import { describe, it, expect, vi, afterEach } from "vitest";

// Mock dependencies before importing
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock @grackle-ai/mcp
vi.mock("@grackle-ai/mcp", () => ({
  createToolRegistry: vi.fn(() => ({
    list: vi.fn(() => []),
    get: vi.fn(() => undefined),
  })),
  authenticateMcpRequest: vi.fn(),
  ToolRegistry: vi.fn(),
}));

// Mock MCP SDK
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn(),
  })),
}));

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(() => ({
    handleRequest: vi.fn(),
    close: vi.fn(),
    sessionId: "test-session",
  })),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  ListToolsRequestSchema: "ListToolsRequestSchema",
  CallToolRequestSchema: "CallToolRequestSchema",
  isInitializeRequest: vi.fn(() => true),
}));

vi.mock("zod-to-json-schema", () => ({
  zodToJsonSchema: vi.fn(() => ({})),
}));

// Mock ConnectRPC
vi.mock("@connectrpc/connect", () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: vi.fn(() => ({})),
}));

import { startMcpBroker, ensureBrokerStarted, shutdownBroker, resetBrokerHandle, type McpBrokerHandle } from "./mcp-broker.js";

describe("startMcpBroker", () => {
  let handle: McpBrokerHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
    resetBrokerHandle();
  });

  it("starts HTTP server on a dynamic port", async () => {
    handle = await startMcpBroker({
      bindHost: "127.0.0.1",
      grpcUrl: "http://127.0.0.1:7434",
      apiKey: "a".repeat(64),
    });

    expect(handle.port).toBeGreaterThan(0);
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(handle.apiKey).toBe("a".repeat(64));
  });

  it("close() shuts down HTTP server", async () => {
    handle = await startMcpBroker({
      bindHost: "127.0.0.1",
      grpcUrl: "http://127.0.0.1:7434",
      apiKey: "b".repeat(64),
    });

    const port = handle.port;
    await handle.close();
    handle = undefined;

    // After close, connecting to that port should fail
    const result = await new Promise<string>((resolve) => {
      const req = require("node:http").get(`http://127.0.0.1:${port}/mcp`, () => {
        resolve("connected");
      });
      req.on("error", () => {
        resolve("refused");
      });
    });
    expect(result).toBe("refused");
  });

  it("returns 404 for non-/mcp paths", async () => {
    handle = await startMcpBroker({
      bindHost: "127.0.0.1",
      grpcUrl: "http://127.0.0.1:7434",
      apiKey: "c".repeat(64),
    });

    const result = await new Promise<number>((resolve, reject) => {
      const req = require("node:http").get(`http://127.0.0.1:${handle!.port}/other`, (res: { statusCode: number }) => {
        resolve(res.statusCode);
      });
      req.on("error", reject);
    });
    expect(result).toBe(404);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const { authenticateMcpRequest } = await import("@grackle-ai/mcp");
    vi.mocked(authenticateMcpRequest).mockReturnValue(undefined);

    handle = await startMcpBroker({
      bindHost: "127.0.0.1",
      grpcUrl: "http://127.0.0.1:7434",
      apiKey: "d".repeat(64),
    });

    const result = await new Promise<number>((resolve, reject) => {
      const req = require("node:http").request(
        `http://127.0.0.1:${handle!.port}/mcp`,
        { method: "POST" },
        (res: { statusCode: number }) => { resolve(res.statusCode); },
      );
      req.on("error", reject);
      req.end("{}");
    });
    expect(result).toBe(401);
  });

  it("returns 405 for unsupported methods", async () => {
    const { authenticateMcpRequest } = await import("@grackle-ai/mcp");
    vi.mocked(authenticateMcpRequest).mockReturnValue({ type: "api-key" });

    handle = await startMcpBroker({
      bindHost: "127.0.0.1",
      grpcUrl: "http://127.0.0.1:7434",
      apiKey: "e".repeat(64),
    });

    const result = await new Promise<number>((resolve, reject) => {
      const req = require("node:http").request(
        `http://127.0.0.1:${handle!.port}/mcp`,
        { method: "PUT" },
        (res: { statusCode: number }) => { resolve(res.statusCode); },
      );
      req.on("error", reject);
      req.end();
    });
    expect(result).toBe(405);
  });
});

describe("ensureBrokerStarted", () => {
  afterEach(async () => {
    await shutdownBroker();
    resetBrokerHandle();
  });

  it("starts broker on first call and returns same handle on subsequent calls", async () => {
    const handle1 = await ensureBrokerStarted("f".repeat(64), "http://127.0.0.1:7434");
    const handle2 = await ensureBrokerStarted("f".repeat(64), "http://127.0.0.1:7434");

    expect(handle1).toBe(handle2);
    expect(handle1.port).toBeGreaterThan(0);
  });
});

describe("shutdownBroker", () => {
  afterEach(() => {
    resetBrokerHandle();
  });

  it("is a no-op when no broker is running", async () => {
    await shutdownBroker();
  });

  it("closes the running broker", async () => {
    const handle = await ensureBrokerStarted("g".repeat(64), "http://127.0.0.1:7434");
    const port = handle.port;
    await shutdownBroker();

    const result = await new Promise<string>((resolve) => {
      const req = require("node:http").get(`http://127.0.0.1:${port}/mcp`, () => {
        resolve("connected");
      });
      req.on("error", () => {
        resolve("refused");
      });
    });
    expect(result).toBe("refused");
  });
});
