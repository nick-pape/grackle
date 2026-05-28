import type { InitializeParams, InitializeResult } from "@grackle-ai/ahp";
import { JsonRpcErrorCodes } from "@grackle-ai/ahp";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import { WsCloseCode } from "./error-codes.js";
import {
  AhpServerSocket,
  type AhpServerConnection,
  type AhpServerSocketOptions,
} from "./ahp-server-socket.js";

const DEFAULT_INIT_RESULT: InitializeResult = {
  protocolVersion: "0.1.0",
  serverSeq: 0,
  snapshots: [],
};

function defaultInitParams(overrides: Partial<InitializeParams> = {}): InitializeParams {
  return {
    channel: "ahp-root://",
    protocolVersions: ["0.1.0"],
    clientId: "client-test",
    _meta: undefined,
    ...overrides,
  };
}

interface TestHarness {
  server: Server;
  socket: AhpServerSocket;
  url: string;
  connections: AhpServerConnection[];
  close(): Promise<void>;
}

async function bootHarness(overrides: Partial<AhpServerSocketOptions> = {}): Promise<TestHarness> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const connections: AhpServerConnection[] = [];
  const socket = new AhpServerSocket({
    server,
    powerlineToken: "tok",
    onInitialize: () => DEFAULT_INIT_RESULT,
    onConnection: (conn) => connections.push(conn),
    ...overrides,
  });
  return {
    server,
    socket,
    url: `ws://127.0.0.1:${port}/ahp`,
    connections,
    async close() {
      await socket.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function connectClient(url: string, token: string | undefined): WebSocket {
  return new WebSocket(url, {
    headers: token !== undefined ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

function rpcCall(
  ws: WebSocket,
  id: number,
  method: string,
  params: unknown,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData): void => {
      const parsed = JSON.parse(data.toString());
      if (parsed.id === id) {
        ws.off("message", onMessage);
        resolve(parsed);
      }
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    setTimeout(() => reject(new Error(`rpcCall(${method}) timeout`)), 5_000);
  });
}

async function expectUpgradeStatus(url: string, token?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = connectClient(url, token);
    ws.on("open", () => {
      ws.close();
      resolve(101);
    });
    ws.on("unexpected-response", (_req, res) => {
      resolve(res.statusCode ?? 0);
    });
    ws.on("error", (err) => {
      // unexpected-response also triggers error in some ws versions; ignore.
      if (!String(err).includes("Unexpected server response")) {
        reject(err);
      }
    });
  });
}

async function waitOpen(ws: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

describe("AhpServerSocket", () => {
  describe("HTTP upgrade auth", () => {
    it("accepts a valid Bearer token (101 Switching Protocols)", async () => {
      const harness = await bootHarness();
      try {
        const status = await expectUpgradeStatus(harness.url, "tok");
        expect(status).toBe(101);
      } finally {
        await harness.close();
      }
    });

    it("rejects an invalid Bearer token with 401", async () => {
      const harness = await bootHarness();
      try {
        const status = await expectUpgradeStatus(harness.url, "wrong");
        expect(status).toBe(401);
      } finally {
        await harness.close();
      }
    });

    it("rejects a missing Authorization header with 401", async () => {
      const harness = await bootHarness();
      try {
        const status = await expectUpgradeStatus(harness.url, undefined);
        expect(status).toBe(401);
      } finally {
        await harness.close();
      }
    });

    it("accepts upgrade with no Bearer when powerlineToken is empty (dev mode)", async () => {
      const harness = await bootHarness({ powerlineToken: "" });
      try {
        const status = await expectUpgradeStatus(harness.url, undefined);
        expect(status).toBe(101);
      } finally {
        await harness.close();
      }
    });

    it("rejects mismatched-length tokens with 401 (constant-time guard)", async () => {
      const harness = await bootHarness();
      try {
        const status = await expectUpgradeStatus(harness.url, "much-longer-wrong-token");
        expect(status).toBe(401);
      } finally {
        await harness.close();
      }
    });

    it("rejects a raw token without the Bearer scheme (no implicit fallback)", async () => {
      // Hand-roll a WS connection that sends `Authorization: <token>` without
      // the `Bearer ` prefix. The server MUST reject with 401.
      const harness = await bootHarness();
      try {
        const wrong = new WebSocket(harness.url, {
          // ws's `headers` option accepts arbitrary key-value strings.
          headers: { Authorization: "tok" },
        });
        const status = await new Promise<number>((resolve) => {
          wrong.on("unexpected-response", (_req, res) => {
            res.destroy();
            resolve(res.statusCode ?? 0);
          });
          wrong.on("error", () => resolve(0));
          wrong.on("open", () => {
            wrong.close();
            resolve(101);
          });
          setTimeout(() => resolve(-1), 500);
        });
        expect(status).toBe(401);
      } finally {
        await harness.close();
      }
    });
  });

  describe("initialize handshake", () => {
    it("fires onConnection after a successful initialize", async () => {
      const harness = await bootHarness();
      try {
        const ws = connectClient(harness.url, "tok");
        await waitOpen(ws);
        const response = await rpcCall(ws, 1, "initialize", defaultInitParams());
        expect(response.result).toEqual(DEFAULT_INIT_RESULT);
        // Give the queueMicrotask a chance to fire.
        await new Promise((r) => setImmediate(r));
        expect(harness.connections).toHaveLength(1);
        expect(harness.connections[0]?.clientId).toBe("client-test");
        ws.close();
      } finally {
        await harness.close();
      }
    });

    it("rejects a non-initialize first request with InvalidRequest", async () => {
      const harness = await bootHarness();
      try {
        const ws = connectClient(harness.url, "tok");
        await waitOpen(ws);
        const response = await rpcCall(ws, 1, "listSessions", {
          channel: "ahp-root://",
          _meta: undefined,
        });
        expect(response.error?.code).toBe(JsonRpcErrorCodes.InvalidRequest);
        expect(harness.connections).toHaveLength(0);
        ws.close();
      } finally {
        await harness.close();
      }
    });

    it("rejects a second initialize on the same connection with InvalidRequest", async () => {
      const harness = await bootHarness();
      try {
        const ws = connectClient(harness.url, "tok");
        await waitOpen(ws);
        const first = await rpcCall(ws, 1, "initialize", defaultInitParams());
        expect(first.result).toEqual(DEFAULT_INIT_RESULT);
        const second = await rpcCall(ws, 2, "initialize", defaultInitParams());
        expect(second.error?.code).toBe(JsonRpcErrorCodes.InvalidRequest);
        ws.close();
      } finally {
        await harness.close();
      }
    });

    it("returns InternalError when onInitialize throws", async () => {
      const harness = await bootHarness({
        onInitialize: () => {
          throw new Error("boot failure");
        },
      });
      try {
        const ws = connectClient(harness.url, "tok");
        await waitOpen(ws);
        const response = await rpcCall(ws, 1, "initialize", defaultInitParams());
        expect(response.error?.code).toBe(JsonRpcErrorCodes.InternalError);
        expect(response.error?.message).toBe("boot failure");
        // onConnection should NOT fire.
        await new Promise((r) => setImmediate(r));
        expect(harness.connections).toHaveLength(0);
        ws.close();
      } finally {
        await harness.close();
      }
    });
  });

  describe("post-initialize request handling", () => {
    it("routes non-initialize requests to onRequest", async () => {
      const calls: Array<{ method: string; clientId: string }> = [];
      const harness = await bootHarness({
        onRequest: async (req, conn) => {
          calls.push({ method: req.method, clientId: conn.clientId });
          return { jsonrpc: "2.0", id: req.id, result: null };
        },
      });
      try {
        const ws = connectClient(harness.url, "tok");
        await waitOpen(ws);
        await rpcCall(ws, 1, "initialize", defaultInitParams({ clientId: "abc" }));
        const r = await rpcCall(ws, 2, "ping", { channel: "ahp-root://", _meta: undefined });
        expect(r.result).toBeNull();
        expect(calls).toEqual([{ method: "ping", clientId: "abc" }]);
        ws.close();
      } finally {
        await harness.close();
      }
    });

    it("returns MethodNotFound when onRequest is not provided", async () => {
      const harness = await bootHarness();
      try {
        const ws = connectClient(harness.url, "tok");
        await waitOpen(ws);
        await rpcCall(ws, 1, "initialize", defaultInitParams());
        const r = await rpcCall(ws, 2, "ping", { channel: "ahp-root://" });
        expect(r.error?.code).toBe(JsonRpcErrorCodes.MethodNotFound);
        ws.close();
      } finally {
        await harness.close();
      }
    });
  });

  describe("disconnect", () => {
    it("fires onDisconnect when an initialized client closes", async () => {
      const disconnects: Array<{ clientId: string; code: number }> = [];
      const harness = await bootHarness({
        onDisconnect: (clientId, code) => disconnects.push({ clientId, code }),
      });
      try {
        const ws = connectClient(harness.url, "tok");
        await waitOpen(ws);
        await rpcCall(ws, 1, "initialize", defaultInitParams({ clientId: "abc" }));
        ws.close(1000);
        await new Promise((r) => setTimeout(r, 100));
        expect(disconnects).toEqual([{ clientId: "abc", code: 1000 }]);
      } finally {
        await harness.close();
      }
    });

    it("does NOT fire onDisconnect for a pre-initialize close", async () => {
      const disconnects: unknown[] = [];
      const harness = await bootHarness({
        onDisconnect: (...args) => disconnects.push(args),
      });
      try {
        const ws = connectClient(harness.url, "tok");
        await waitOpen(ws);
        // Close before sending initialize.
        ws.close(1000);
        await new Promise((r) => setTimeout(r, 100));
        expect(disconnects).toEqual([]);
      } finally {
        await harness.close();
      }
    });
  });

  describe("heartbeat", () => {
    it("periodically pings the client (observed on the client side)", async () => {
      // Real ws clients auto-pong, so we observe the SERVER's outbound pings
      // landing on the client. With a 30ms interval, we expect ≥3 pings in 150ms.
      const harness = await bootHarness({ heartbeatIntervalMs: 30 });
      try {
        const ws = connectClient(harness.url, "tok");
        await waitOpen(ws);
        await rpcCall(ws, 1, "initialize", defaultInitParams());
        let pings = 0;
        ws.on("ping", () => {
          pings += 1;
        });
        await new Promise((r) => setTimeout(r, 150));
        expect(pings).toBeGreaterThanOrEqual(3);
        ws.close();
      } finally {
        await harness.close();
      }
    });

    it("closes with code 4001 when missed-pong threshold is exceeded", async () => {
      // With missedLimit=0, the FIRST interval tick increments missedPongs to
      // 1 (>= 0) and closes immediately, before any auto-pong can reset it.
      const harness = await bootHarness({
        heartbeatIntervalMs: 30,
        heartbeatMissedLimit: 0,
      });
      try {
        const ws = connectClient(harness.url, "tok");
        await waitOpen(ws);
        await rpcCall(ws, 1, "initialize", defaultInitParams());
        const code = await new Promise<number>((resolve) => {
          ws.once("close", (c) => resolve(c));
        });
        expect(code).toBe(WsCloseCode.HeartbeatTimeout);
      } finally {
        await harness.close();
      }
    });
  });

  describe("close()", () => {
    it("stops accepting new connections (post-close upgrade is not 101)", async () => {
      const harness = await bootHarness();
      await harness.socket.close();
      // After close, our upgrade listener is detached. Connecting may hang,
      // 426, or get destroyed — anything except 101.
      const wrong = connectClient(harness.url, "tok");
      const status = await new Promise<number>((resolve) => {
        wrong.on("unexpected-response", (_req, res) => {
          resolve(res.statusCode ?? 0);
          res.destroy();
        });
        wrong.on("error", () => resolve(0));
        wrong.on("open", () => {
          wrong.close();
          resolve(101);
        });
        setTimeout(() => {
          wrong.terminate();
          resolve(-1);
        }, 500);
      });
      expect(status).not.toBe(101);
      await new Promise<void>((resolve) => harness.server.close(() => resolve()));
    });

    it("close() is idempotent", async () => {
      const harness = await bootHarness();
      try {
        await harness.socket.close();
        await expect(harness.socket.close()).resolves.toBeUndefined();
      } finally {
        await new Promise<void>((resolve) => harness.server.close(() => resolve()));
      }
    });
  });
});
