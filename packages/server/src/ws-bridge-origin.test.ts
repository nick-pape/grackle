/**
 * Tests for WebSocket Origin header validation (GHSA-w3hv-x4fp-6h6j).
 * Covers both the pure `isAllowedOrigin` function and integration tests
 * that verify the server rejects connections with disallowed origins.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import WebSocket from "ws";

// ── Mock heavy dependencies before importing the bridge ──────────

vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./log-writer.js", () => ({
  initLog: vi.fn(),
  writeEvent: vi.fn(),
  endSession: vi.fn(),
  readLog: vi.fn(() => []),
}));

vi.mock("./stream-hub.js", () => ({
  publish: vi.fn(),
  createStream: vi.fn(() => {
    const iter = (async function* () {})();
    return Object.assign(iter, { cancel: vi.fn() });
  }),
  createGlobalStream: vi.fn(() => {
    const iter = (async function* () {})();
    return Object.assign(iter, { cancel: vi.fn() });
  }),
}));

vi.mock("./ws-broadcast.js", () => ({
  broadcast: vi.fn(),
  setWssInstance: vi.fn(),
}));

vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

vi.mock("./token-store.js", () => ({
  listTokens: vi.fn(() => []),
  setToken: vi.fn(),
  deleteToken: vi.fn(),
}));

vi.mock("./token-push.js", () => ({
  pushToEnv: vi.fn(),
  pushProviderCredentialsToEnv: vi.fn(),
  refreshTokensForTask: vi.fn(),
}));

vi.mock("./env-registry.js", () => ({
  listEnvironments: vi.fn(() => []),
  getEnvironment: vi.fn(() => undefined),
  addEnvironment: vi.fn(),
  removeEnvironment: vi.fn(),
  updateEnvironmentStatus: vi.fn(),
  markBootstrapped: vi.fn(),
}));

vi.mock("./workspace-store.js", () => ({
  listWorkspaces: vi.fn(() => []),
  getWorkspace: vi.fn(() => undefined),
  createWorkspace: vi.fn(),
  archiveWorkspace: vi.fn(),
  countWorkspacesByEnvironment: vi.fn(() => 0),
}));

vi.mock("./task-store.js", () => ({
  listTasks: vi.fn(() => []),
  buildChildIdsMap: vi.fn(() => new Map()),
  getTask: vi.fn(() => undefined),
  createTask: vi.fn(),
  markTaskComplete: vi.fn(),
  checkAndUnblock: vi.fn(() => []),
  areDependenciesMet: vi.fn(() => true),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  getChildren: vi.fn(() => []),
}));

vi.mock("./finding-store.js", () => ({
  queryFindings: vi.fn(() => []),
  postFinding: vi.fn(),
}));

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  reconnectOrProvision: vi.fn(async function* () {}),
}));

vi.mock("./system-prompt-builder.js", () => ({
  SystemPromptBuilder: vi.fn().mockImplementation(() => ({ build: () => "" })),
  buildTaskPrompt: vi.fn((title: string) => title),
}));

vi.mock("./utils/slugify.js", () => ({
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-")),
}));

vi.mock("./event-processor.js", () => ({
  processEventStream: vi.fn(),
}));

vi.mock("./utils/exec.js", () => ({
  exec: vi.fn(),
}));

// Import AFTER mocks
import { isAllowedOrigin, createWsBridge } from "./ws-bridge.js";

// ── Unit tests for the pure isAllowedOrigin function ─────────────

describe("isAllowedOrigin", () => {
  const WEB_PORT = 3000;

  it("allows connections with no origin header", () => {
    expect(isAllowedOrigin(undefined, WEB_PORT, false)).toBe(true);
  });

  it("rejects connections with empty-string origin", () => {
    expect(isAllowedOrigin("", WEB_PORT, false)).toBe(false);
  });

  it("allows http://localhost on the correct port", () => {
    expect(isAllowedOrigin("http://localhost:3000", WEB_PORT, false)).toBe(true);
  });

  it("allows http://127.0.0.1 on the correct port", () => {
    expect(isAllowedOrigin("http://127.0.0.1:3000", WEB_PORT, false)).toBe(true);
  });

  it("allows http://[::1] on the correct port", () => {
    expect(isAllowedOrigin("http://[::1]:3000", WEB_PORT, false)).toBe(true);
  });

  it("rejects a cross-origin host in local mode", () => {
    expect(isAllowedOrigin("http://evil.com:3000", WEB_PORT, false)).toBe(false);
  });

  it("rejects localhost on the wrong port", () => {
    expect(isAllowedOrigin("http://localhost:9999", WEB_PORT, false)).toBe(false);
  });

  it("rejects a LAN IP in local mode", () => {
    expect(isAllowedOrigin("http://192.168.1.100:3000", WEB_PORT, false)).toBe(false);
  });

  it("rejects malformed origin strings", () => {
    expect(isAllowedOrigin("not-a-url", WEB_PORT, false)).toBe(false);
  });

  it("allows any hostname on the correct port when allowNetwork is true", () => {
    expect(isAllowedOrigin("http://192.168.1.100:3000", WEB_PORT, true)).toBe(true);
    expect(isAllowedOrigin("http://my-laptop.local:3000", WEB_PORT, true)).toBe(true);
  });

  it("rejects wrong port even when allowNetwork is true", () => {
    expect(isAllowedOrigin("http://192.168.1.100:9999", WEB_PORT, true)).toBe(false);
  });

  it("handles default HTTP port correctly", () => {
    expect(isAllowedOrigin("http://localhost", 80, false)).toBe(true);
    expect(isAllowedOrigin("http://localhost", 3000, false)).toBe(false);
  });

  it("handles default HTTPS port correctly", () => {
    expect(isAllowedOrigin("https://localhost", 443, false)).toBe(true);
    expect(isAllowedOrigin("https://localhost", 3000, false)).toBe(false);
  });
});

// ── Integration tests with real HTTP+WS server ──────────────────

describe("ws-bridge origin validation", () => {
  let httpServer: HttpServer;
  let port: number;
  const openSockets: WebSocket[] = [];

  function connectWs(
    opts: { token?: string; origin?: string } = {},
  ): Promise<WebSocket> {
    const token = opts.token ?? "test-token";
    const headers: Record<string, string> = {};
    if (opts.origin !== undefined) {
      headers["Origin"] = opts.origin;
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`, { headers });
      openSockets.push(ws);
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  }

  function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
    return new Promise((resolve) => {
      ws.once("close", (code: number, reason: Buffer) => {
        resolve({ code, reason: reason.toString() });
      });
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    httpServer = createServer();

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    port = (httpServer.address() as { port: number }).port;

    createWsBridge(httpServer, {
      verifyApiKey: (token) => token === "test-token",
      webPort: port,
      allowNetwork: false,
    });
  });

  afterEach(async () => {
    for (const ws of openSockets) {
      if (ws.readyState !== WebSocket.CLOSED) {
        await new Promise<void>((resolve) => {
          ws.once("close", () => resolve());
          ws.close();
        });
      }
    }
    openSockets.length = 0;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("closes connection with 4003 when Origin is disallowed", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=test-token`, {
      headers: { Origin: "http://evil.com" },
    });
    openSockets.push(ws);

    const { code, reason } = await waitForClose(ws);
    expect(code).toBe(4003);
    expect(reason).toBe("Forbidden origin");
  });

  it("allows connection when Origin matches localhost on the correct port", async () => {
    const ws = await connectWs({ origin: `http://localhost:${port}` });
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it("allows connection when no Origin header is present", async () => {
    const ws = await connectWs();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});
