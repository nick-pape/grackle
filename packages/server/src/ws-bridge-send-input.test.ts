/**
 * Unit tests for the send_input WebSocket message handler error paths.
 * Tests that invalid/missing sessions and disconnected environments
 * result in proper error messages rather than silent drops.
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

vi.mock("./token-broker.js", () => ({
  pushToEnv: vi.fn(),
  pushProviderCredentialsToEnv: vi.fn(),
  refreshTokensForTask: vi.fn(),
  listTokens: vi.fn(() => []),
  setToken: vi.fn(),
  deleteToken: vi.fn(),
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

vi.mock("./utils/system-context.js", () => ({
  buildTaskSystemContext: vi.fn(() => ""),
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
import { createWsBridge } from "./ws-bridge.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import { sqlite } from "./test-db.js";

/** Apply the minimal SQLite schema needed for session tests. */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id                 TEXT PRIMARY KEY,
      env_id             TEXT NOT NULL DEFAULT '',
      runtime            TEXT NOT NULL DEFAULT '',
      runtime_session_id TEXT,
      prompt             TEXT NOT NULL DEFAULT '',
      model              TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'pending',
      log_path           TEXT,
      turns              INTEGER NOT NULL DEFAULT 0,
      started_at         TEXT NOT NULL DEFAULT (datetime('now')),
      suspended_at       TEXT,
      ended_at           TEXT,
      error              TEXT,
      task_id            TEXT NOT NULL DEFAULT '',
      persona_id         TEXT NOT NULL DEFAULT ''
    );
  `);
}

/** Track open sockets so afterEach can clean them up. */
const openSockets: WebSocket[] = [];

/** Helper: connect a WebSocket to the test server and wait for it to open. */
function connectWs(port: number, token = "test-token"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`);
    openSockets.push(ws);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Helper: close a WebSocket and wait for the close handshake to complete. */
function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once("close", () => resolve());
    ws.close();
  });
}

/** Helper: wait for the next JSON message on a WebSocket. */
function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WS message")), 3000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    });
  });
}

describe("ws-bridge send_input error handling", () => {
  let httpServer: HttpServer;
  let port: number;

  beforeEach(async () => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    applySchema();
    vi.clearAllMocks();

    httpServer = createServer();
    createWsBridge(httpServer, (token) => token === "test-token");

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    port = (httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    // Close any open client sockets before shutting down the server
    await Promise.all(openSockets.map((ws) => closeWs(ws)));
    openSockets.length = 0;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("returns error when sessionId is missing", async () => {
    const ws = await connectWs(port);
    const msgPromise = nextMessage(ws);

    ws.send(JSON.stringify({ type: "send_input", payload: { text: "hello" } }));

    const msg = await msgPromise;
    await closeWs(ws);

    expect(msg.type).toBe("error");
    expect((msg.payload as Record<string, unknown>).message).toMatch(/sessionId and text required/i);
  });

  it("returns error when text is missing", async () => {
    const ws = await connectWs(port);
    const msgPromise = nextMessage(ws);

    ws.send(JSON.stringify({ type: "send_input", payload: { sessionId: "sess-1" } }));

    const msg = await msgPromise;
    await closeWs(ws);

    expect(msg.type).toBe("error");
    expect((msg.payload as Record<string, unknown>).message).toMatch(/sessionId and text required/i);
  });

  it("returns error when session does not exist", async () => {
    const ws = await connectWs(port);
    const msgPromise = nextMessage(ws);

    ws.send(JSON.stringify({ type: "send_input", payload: { sessionId: "no-such-session", text: "hello" } }));

    const msg = await msgPromise;
    await closeWs(ws);

    expect(msg.type).toBe("error");
    expect((msg.payload as Record<string, unknown>).message).toMatch(/Session not found: no-such-session/i);
  });

  it("returns error when session is completed", async () => {
    sessionStore.createSession("sess-completed", "env-1", "node", "test", "claude", "/tmp/log");
    sessionStore.updateSession("sess-completed", "completed");

    const ws = await connectWs(port);
    const msgPromise = nextMessage(ws);

    ws.send(JSON.stringify({ type: "send_input", payload: { sessionId: "sess-completed", text: "hello" } }));

    const msg = await msgPromise;
    await closeWs(ws);

    expect(msg.type).toBe("error");
    expect((msg.payload as Record<string, unknown>).message).toMatch(/not currently idle.*completed/i);
  });

  it("returns error when session is failed", async () => {
    sessionStore.createSession("sess-failed", "env-1", "node", "test", "claude", "/tmp/log");
    sessionStore.updateSession("sess-failed", "failed");

    const ws = await connectWs(port);
    const msgPromise = nextMessage(ws);

    ws.send(JSON.stringify({ type: "send_input", payload: { sessionId: "sess-failed", text: "hello" } }));

    const msg = await msgPromise;
    await closeWs(ws);

    expect(msg.type).toBe("error");
    expect((msg.payload as Record<string, unknown>).message).toMatch(/not currently idle.*failed/i);
  });

  it("returns error when session is interrupted", async () => {
    sessionStore.createSession("sess-interrupted", "env-1", "node", "test", "claude", "/tmp/log");
    sessionStore.updateSession("sess-interrupted", "interrupted");

    const ws = await connectWs(port);
    const msgPromise = nextMessage(ws);

    ws.send(JSON.stringify({ type: "send_input", payload: { sessionId: "sess-interrupted", text: "hello" } }));

    const msg = await msgPromise;
    await closeWs(ws);

    expect(msg.type).toBe("error");
    expect((msg.payload as Record<string, unknown>).message).toMatch(/not currently idle.*interrupted/i);
  });

  it("returns error when environment is not connected", async () => {
    sessionStore.createSession("sess-active", "env-disconnected", "node", "test", "claude", "/tmp/log");
    sessionStore.updateSession("sess-active", "idle");

    // getConnection returns undefined (not connected)
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(undefined);

    const ws = await connectWs(port);
    const msgPromise = nextMessage(ws);

    ws.send(JSON.stringify({ type: "send_input", payload: { sessionId: "sess-active", text: "hello" } }));

    const msg = await msgPromise;
    await closeWs(ws);

    expect(msg.type).toBe("error");
    expect((msg.payload as Record<string, unknown>).message).toMatch(/env-disconnected.*not connected/i);
  });

  it("returns error when sendInput RPC throws", async () => {
    sessionStore.createSession("sess-rpc-err", "env-1", "node", "test", "claude", "/tmp/log");
    sessionStore.updateSession("sess-rpc-err", "idle");

    const mockConn = {
      client: {
        sendInput: vi.fn().mockRejectedValue(new Error("gRPC connection reset")),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(mockConn as any);

    const ws = await connectWs(port);
    const msgPromise = nextMessage(ws);

    ws.send(JSON.stringify({ type: "send_input", payload: { sessionId: "sess-rpc-err", text: "hello" } }));

    const msg = await msgPromise;
    await closeWs(ws);

    expect(msg.type).toBe("error");
    expect((msg.payload as Record<string, unknown>).message).toMatch(/Failed to send input/i);
  });

  it("sends no error response when input is delivered successfully", async () => {
    sessionStore.createSession("sess-ok", "env-1", "node", "test", "claude", "/tmp/log");
    sessionStore.updateSession("sess-ok", "idle");

    const mockConn = {
      client: {
        sendInput: vi.fn().mockResolvedValue({}),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(mockConn as any);

    const ws = await connectWs(port);

    const receivedMessages: { type: string }[] = [];
    ws.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as { type: string };
        receivedMessages.push(parsed);
      } catch {
        // Ignore malformed messages for this test
      }
    });

    ws.send(JSON.stringify({ type: "send_input", payload: { sessionId: "sess-ok", text: "hello" } }));

    // Wait briefly to observe any potential error response
    await new Promise((r) => setTimeout(r, 200));

    await closeWs(ws);

    const receivedError = receivedMessages.some((msg) => msg.type === "error");
    expect(receivedError).toBe(false);
    expect(mockConn.client.sendInput).toHaveBeenCalledOnce();
  });
});
