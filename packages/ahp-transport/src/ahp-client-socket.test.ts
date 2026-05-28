import type { InitializeResult } from "@grackle-ai/ahp";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

import { AhpClientSocket, type AhpConnectionState } from "./ahp-client-socket.js";
import { exponentialBackoff } from "./backoff.js";
import { InMemoryClientIdStore } from "./client-id-store.js";
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

interface ServerHarness {
  server: Server;
  socket: AhpServerSocket;
  url: string;
  connections: AhpServerConnection[];
  close(): Promise<void>;
}

async function bootServer(overrides: Partial<AhpServerSocketOptions> = {}): Promise<ServerHarness> {
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

describe("AhpClientSocket", () => {
  describe("initial connection", () => {
    it("opens, runs initialize, and persists the clientId", async () => {
      const harness = await bootServer();
      const store = new InMemoryClientIdStore();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: store,
        clientIdKey: "test-host",
      });
      try {
        const result = await client.open();
        expect(result).toEqual(DEFAULT_INIT_RESULT);
        expect(client.state).toBe("open");
        expect(client.clientId).toBeDefined();
        // Same id is in the store.
        expect(await store.load("test-host")).toBe(client.clientId);
      } finally {
        await client.close();
        await harness.close();
      }
    });

    it("reuses a prior clientId from the store on subsequent opens", async () => {
      const harness = await bootServer();
      const store = new InMemoryClientIdStore();
      await store.save("test-host", "preset-client-id");
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: store,
        clientIdKey: "test-host",
      });
      try {
        await client.open();
        expect(client.clientId).toBe("preset-client-id");
        // Server-side connection saw the same id.
        expect(harness.connections[0]?.clientId).toBe("preset-client-id");
      } finally {
        await client.close();
        await harness.close();
      }
    });

    it("reports state transitions through connecting → open", async () => {
      const harness = await bootServer();
      const states: AhpConnectionState[] = [];
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        onStateChange: (s) => states.push(s),
      });
      try {
        await client.open();
        expect(states).toEqual(["connecting", "open"]);
      } finally {
        await client.close();
        await harness.close();
      }
    });
  });

  describe("reconnect", () => {
    it("transitions open → reconnecting → open on server-initiated close, preserving clientId", async () => {
      const harness = await bootServer();
      const store = new InMemoryClientIdStore();
      const states: AhpConnectionState[] = [];
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: store,
        clientIdKey: "k",
        onStateChange: (s) => states.push(s),
        // Modest backoff so we have time to observe the reconnecting state
        // but still complete the test quickly.
        backoff: exponentialBackoff({ initialMs: 50, maxMs: 50, jitter: 0 }),
      });
      try {
        await client.open();
        const originalId = client.clientId!;
        // Server kicks the only connection.
        const conn = harness.connections[0];
        expect(conn).toBeDefined();
        conn!.session.close(1011, "server restart");
        // First observe the reconnecting state, THEN the back-to-open state.
        await waitForState(client, "reconnecting", 1_000);
        await waitForState(client, "open", 2_000);
        expect(client.clientId).toBe(originalId);
        expect(states).toContain("reconnecting");
        expect(states[states.length - 1]).toBe("open");
      } finally {
        await client.close();
        await harness.close();
      }
    });

    it("does NOT reconnect after server close 4401 (auth rejected)", async () => {
      const harness = await bootServer();
      const states: AhpConnectionState[] = [];
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        onStateChange: (s) => states.push(s),
        backoff: exponentialBackoff({ initialMs: 1, maxMs: 10, jitter: 0 }),
      });
      try {
        await client.open();
        const conn = harness.connections[0]!;
        conn.session.close(WsCloseCode.AuthRejected, "no");
        await waitForState(client, "closed", 1_000);
        // No subsequent "open" — terminal.
        const finalState = client.state;
        expect(finalState).toBe("closed");
      } finally {
        // Already closed; harness shutdown only.
        await harness.close();
      }
    });
  });

  describe("queued operations", () => {
    it("queues request() during reconnect and flushes on next open", async () => {
      const harness = await bootServer({
        onRequest: async (req) => ({ jsonrpc: "2.0", id: req.id, result: null }),
      });
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        backoff: exponentialBackoff({ initialMs: 200, maxMs: 200, jitter: 0 }),
      });
      try {
        await client.open();
        const conn = harness.connections[0]!;
        // Kick the connection and wait for the client to observe reconnecting.
        conn.session.close(1011, "restart");
        await waitForState(client, "reconnecting", 1_000);
        // Now issue the request — session is undefined; it must queue.
        const promise = client.request("ping", { channel: "ahp-root://", _meta: undefined });
        await waitForState(client, "open", 2_000);
        await expect(promise).resolves.toBeNull();
      } finally {
        await client.close();
        await harness.close();
      }
    });

    it("rejects request() invoked after close()", async () => {
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
      });
      await client.open();
      await client.close();
      await expect(
        client.request("ping", { channel: "ahp-root://", _meta: undefined }),
      ).rejects.toMatchObject({ kind: "user-closed" });
      await harness.close();
    });

    it("rejects queued requests on close() during reconnect", async () => {
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        backoff: exponentialBackoff({ initialMs: 1_000, maxMs: 1_000, jitter: 0 }),
      });
      try {
        await client.open();
        // Kick the connection, then issue a request while reconnecting.
        const conn = harness.connections[0]!;
        conn.session.close(1011, "restart");
        await waitForState(client, "reconnecting", 1_000);
        const promise = client.request("ping", { channel: "ahp-root://", _meta: undefined });
        // Closing client cancels queued ops.
        await client.close();
        await expect(promise).rejects.toMatchObject({ kind: "user-closed" });
      } finally {
        await harness.close();
      }
    });

    it("notify() during reconnect is silently dropped (not queued)", async () => {
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        // Slow backoff so we have time to observe reconnecting.
        backoff: exponentialBackoff({ initialMs: 1_000, maxMs: 1_000, jitter: 0 }),
      });
      try {
        await client.open();
        const conn = harness.connections[0]!;
        conn.session.close(1011, "restart");
        await waitForState(client, "reconnecting", 1_000);
        // Should not throw even though the session is undefined.
        expect(() =>
          client.notify("unsubscribe", { channel: "ahp-session:/x", _meta: undefined }),
        ).not.toThrow();
      } finally {
        await client.close();
        await harness.close();
      }
    });
  });

  describe("lifecycle edge cases", () => {
    it("open() after close() throws user-closed", async () => {
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
      });
      await client.open();
      await client.close();
      await expect(client.open()).rejects.toMatchObject({ kind: "user-closed" });
      await harness.close();
    });

    it("open() while already open throws connection-lost", async () => {
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
      });
      try {
        await client.open();
        await expect(client.open()).rejects.toMatchObject({ kind: "connection-lost" });
      } finally {
        await client.close();
        await harness.close();
      }
    });

    it("close() is idempotent", async () => {
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
      });
      try {
        await client.open();
        await client.close();
        await expect(client.close()).resolves.toBeUndefined();
      } finally {
        await harness.close();
      }
    });

    it("rejects open() if the WebSocket constructor throws synchronously", async () => {
      // Inject a ctor that throws on `new` to simulate a malformed URL.
      const ThrowingCtor = function (_url: string) {
        throw new Error("bad url");
      } as unknown as typeof WebSocket;
      const client = new AhpClientSocket({
        url: "ws://localhost:0/ahp",
        powerlineToken: "",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        webSocketCtor: ThrowingCtor,
        backoff: exponentialBackoff({ initialMs: 1_000_000, maxMs: 1_000_000, jitter: 0 }),
      });
      await expect(client.open()).rejects.toThrow(/bad url/);
      // Synchronous initial failure must transition to "closed" so the caller
      // can call open() again, AND must NOT start background retries.
      expect(client.state).toBe("closed");
      await client.close();
    });

    it("rejects open() called while connecting (no race)", async () => {
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
      });
      try {
        const first = client.open();
        // Don't await first; second call should reject immediately.
        await expect(client.open()).rejects.toMatchObject({ kind: "connection-lost" });
        await first;
      } finally {
        await client.close();
        await harness.close();
      }
    });

    it("rejects open() called while reconnecting", async () => {
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        // Slow backoff so the client stays in "reconnecting" long enough.
        backoff: exponentialBackoff({ initialMs: 5_000, maxMs: 5_000, jitter: 0 }),
      });
      try {
        await client.open();
        const conn = harness.connections[0]!;
        conn.session.close(1011, "restart");
        await waitForState(client, "reconnecting", 1_000);
        await expect(client.open()).rejects.toMatchObject({ kind: "connection-lost" });
      } finally {
        await client.close();
        await harness.close();
      }
    });

    it("fails initial open() and transitions to closed on auth rejection (401)", async () => {
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "wrong-token",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        // Long backoff: if we mistakenly scheduled a reconnect, it would
        // remain in "reconnecting" long enough to fail the state assertion.
        backoff: exponentialBackoff({ initialMs: 1_000_000, maxMs: 1_000_000, jitter: 0 }),
      });
      try {
        await expect(client.open()).rejects.toBeDefined();
        expect(client.state).toBe("closed");
      } finally {
        await client.close();
        await harness.close();
      }
    });

    it("fails initial open() terminally when initialize handler throws", async () => {
      const harness = await bootServer({
        onInitialize: () => {
          throw new Error("boot failure");
        },
      });
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        backoff: exponentialBackoff({ initialMs: 1_000_000, maxMs: 1_000_000, jitter: 0 }),
      });
      try {
        await expect(client.open()).rejects.toBeDefined();
        // Handshake failure is terminal — must NOT start background retries.
        expect(client.state).toBe("closed");
      } finally {
        await client.close();
        await harness.close();
      }
    });

    it("terminates the lifecycle when close() is called during loadOrMintClientId", async () => {
      // Inject a slow store so we can call close() in the gap between the
      // synchronous open() entry and the async store load.
      const slowStore = {
        load: async () =>
          new Promise<undefined>((r) => {
            setTimeout(() => r(undefined), 50);
          }),
        save: async () => undefined,
      };
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: slowStore,
        clientIdKey: "k",
      });
      try {
        const openP = client.open();
        // Close while load is in flight.
        await client.close();
        await expect(openP).rejects.toMatchObject({ kind: "user-closed" });
        expect(client.state).toBe("closed");
      } finally {
        await harness.close();
      }
    });

    it("treats reconnect-time HTTP 401 upgrade rejection as terminal (no retry loop)", async () => {
      // Two servers on the same port, sequenced. First accepts the client,
      // then we kill it. Second listens on the same port but requires a
      // different token, so the client's reconnect attempt gets 401.
      const { createServer } = await import("node:http");
      const v1 = createServer();
      await new Promise<void>((r) => v1.listen(0, "127.0.0.1", r));
      const port = (v1.address() as { port: number }).port;
      const v1Ahp = new AhpServerSocket({
        server: v1,
        powerlineToken: "good",
        onInitialize: () => DEFAULT_INIT_RESULT,
      });
      const client = new AhpClientSocket({
        url: `ws://127.0.0.1:${port}/ahp`,
        powerlineToken: "good",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        backoff: exponentialBackoff({ initialMs: 20, maxMs: 20, jitter: 0 }),
      });
      try {
        await client.open();
        // Bring down v1.
        await v1Ahp.close();
        await new Promise<void>((r) => v1.close(() => r()));
        // Bring up v2 with a different token on the same port.
        const v2 = createServer();
        await new Promise<void>((r) => v2.listen(port, "127.0.0.1", r));
        const v2Ahp = new AhpServerSocket({
          server: v2,
          powerlineToken: "different",
          onInitialize: () => DEFAULT_INIT_RESULT,
        });
        try {
          // Client should reconnect, get 401, and terminate (NOT loop).
          await waitForState(client, "closed", 5_000);
        } finally {
          await v2Ahp.close();
          await new Promise<void>((r) => v2.close(() => r()));
        }
      } finally {
        await client.close();
      }
    });

    it("terminates reconnect cycle when a reconnect-time initialize fails (no infinite retry)", async () => {
      // Start with a server that accepts initialize, get the client to "open",
      // then swap the handler to throw on initialize and kick the connection.
      let initShouldThrow = false;
      const harness = await bootServer({
        onInitialize: () => {
          if (initShouldThrow) {
            throw new Error("handshake denied on retry");
          }
          return DEFAULT_INIT_RESULT;
        },
      });
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        backoff: exponentialBackoff({ initialMs: 20, maxMs: 20, jitter: 0 }),
      });
      try {
        await client.open();
        // Flip the server to reject the next initialize.
        initShouldThrow = true;
        // Kick the connection — client will reconnect and the initialize will
        // be rejected by the server, which must terminate the lifecycle.
        const conn = harness.connections[0]!;
        conn.session.close(1011, "restart");
        // Wait for the state to settle into "closed". If the client mistakenly
        // kept retrying, this would time out (still in "reconnecting").
        await waitForState(client, "closed", 2_000);
      } finally {
        await client.close();
        await harness.close();
      }
    });
  });

  describe("backoff sequence", () => {
    let realClearInterval: typeof clearInterval;
    let realSetInterval: typeof setInterval;
    beforeEach(() => {
      realSetInterval = global.setInterval;
      realClearInterval = global.clearInterval;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    afterEach(() => {
      vi.useRealTimers();
      global.setInterval = realSetInterval;
      global.clearInterval = realClearInterval;
    });

    it("uses the supplied BackoffPolicy.next() between reconnect attempts", async () => {
      // We can't easily observe the delay values from the outside, so we
      // instead inject a custom BackoffPolicy that records next()/reset()
      // calls.
      const delays = [1, 2, 4];
      let i = 0;
      const recorded: string[] = [];
      const policy = {
        next: () => {
          recorded.push(`next:${delays[i] ?? 0}`);
          return delays[i++] ?? 0;
        },
        reset: () => {
          recorded.push("reset");
        },
      };
      const harness = await bootServer();
      const client = new AhpClientSocket({
        url: harness.url,
        powerlineToken: "tok",
        clientIdStore: new InMemoryClientIdStore(),
        clientIdKey: "k",
        backoff: policy,
      });
      try {
        await client.open();
        // After open: reset() should have been called.
        expect(recorded).toContain("reset");
        recorded.length = 0;
        // Kick and observe next() being called.
        const conn = harness.connections[0]!;
        conn.session.close(1011, "restart");
        await vi.waitFor(() => {
          expect(recorded.some((r) => r.startsWith("next:"))).toBe(true);
        });
      } finally {
        await client.close();
        await harness.close();
      }
    });
  });
});

async function waitForState(
  client: AhpClientSocket,
  target: AhpConnectionState,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (client.state !== target) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for state=${target}; currently ${client.state}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
