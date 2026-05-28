/**
 * Loopback integration test — proves that AhpServerSocket and AhpClientSocket
 * compose correctly over real ws + real http.createServer (no mocks, no fake
 * timers). This is the public-surface smoke test that consumers (HR8b's
 * MultiHostClient, HR8d's PowerLine AHP host) will rely on.
 */

import type { InitializeResult } from "@grackle-ai/ahp";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { AhpClientSocket } from "./ahp-client-socket.js";
import { exponentialBackoff } from "./backoff.js";
import { InMemoryClientIdStore } from "./client-id-store.js";
import { AhpServerSocket, type AhpServerConnection } from "./ahp-server-socket.js";

const INIT_RESULT: InitializeResult = {
  protocolVersion: "0.1.0",
  serverSeq: 0,
  snapshots: [],
};

async function listenOn(port: number): Promise<{ server: Server; port: number }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

describe("AhpServerSocket + AhpClientSocket loopback", () => {
  it("completes the initialize handshake over real ws", async () => {
    const { server, port } = await listenOn(0);
    const wireConnections: AhpServerConnection[] = [];
    const ahp = new AhpServerSocket({
      server,
      powerlineToken: "tok",
      onInitialize: () => INIT_RESULT,
      onConnection: (c) => wireConnections.push(c),
    });
    const client = new AhpClientSocket({
      url: `ws://127.0.0.1:${port}/ahp`,
      powerlineToken: "tok",
      clientIdStore: new InMemoryClientIdStore(),
      clientIdKey: "loopback",
    });
    try {
      const result = await client.open();
      expect(result).toEqual(INIT_RESULT);
      // queueMicrotask in onConnection means we may need a tick to settle.
      await new Promise((r) => setImmediate(r));
      expect(wireConnections).toHaveLength(1);
      expect(wireConnections[0]?.clientId).toBe(client.clientId);
    } finally {
      await client.close();
      await ahp.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("routes a typed request round-trip via the AHP wire", async () => {
    const { server, port } = await listenOn(0);
    const ahp = new AhpServerSocket({
      server,
      powerlineToken: "tok",
      onInitialize: () => INIT_RESULT,
      onRequest: async (req) => {
        // Echo: respond with the params back as the result.
        return { jsonrpc: "2.0", id: req.id, result: null };
      },
    });
    const client = new AhpClientSocket({
      url: `ws://127.0.0.1:${port}/ahp`,
      powerlineToken: "tok",
      clientIdStore: new InMemoryClientIdStore(),
      clientIdKey: "loopback",
    });
    try {
      await client.open();
      const result = await client.request("ping", {
        channel: "ahp-root://",
        _meta: undefined,
      });
      expect(result).toBeNull();
    } finally {
      await client.close();
      await ahp.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("propagates notifications in both directions", async () => {
    const { server, port } = await listenOn(0);
    const serverSawNotifications: Array<{ method: string; clientId: string }> = [];
    const clientSawNotifications: string[] = [];

    const ahp = new AhpServerSocket({
      server,
      powerlineToken: "tok",
      onInitialize: () => INIT_RESULT,
      onConnection: (conn) => {
        // After init, server pushes one "action" notification to the client.
        queueMicrotask(() => {
          conn.session.notify("action", {
            channel: "ahp-session:/demo",
            serverSeq: 1,
            action: { type: "session/ready", payload: {} },
          });
        });
      },
      onNotification: (notif, conn) => {
        serverSawNotifications.push({ method: notif.method, clientId: conn.clientId });
      },
    });

    const client = new AhpClientSocket({
      url: `ws://127.0.0.1:${port}/ahp`,
      powerlineToken: "tok",
      clientIdStore: new InMemoryClientIdStore(),
      clientIdKey: "loopback",
      onNotification: (notif) => {
        clientSawNotifications.push(notif.method);
      },
    });
    try {
      await client.open();
      // Wait a beat for the server's initial notification.
      await new Promise((r) => setTimeout(r, 50));
      expect(clientSawNotifications).toEqual(["action"]);

      // Client → server direction: send a dispatchAction notification.
      client.notify("dispatchAction", {
        channel: "ahp-session:/demo",
        clientSeq: 1,
        action: { type: "user/input", payload: { text: "hi" } },
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(serverSawNotifications).toEqual([
        { method: "dispatchAction", clientId: client.clientId },
      ]);
    } finally {
      await client.close();
      await ahp.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("client reconnects to a restarted server preserving its clientId", async () => {
    // Boot v1 of the server on a known free port.
    const { server: v1Server, port } = await listenOn(0);
    const v1Ahp = new AhpServerSocket({
      server: v1Server,
      powerlineToken: "tok",
      onInitialize: () => INIT_RESULT,
    });
    const store = new InMemoryClientIdStore();
    const client = new AhpClientSocket({
      url: `ws://127.0.0.1:${port}/ahp`,
      powerlineToken: "tok",
      clientIdStore: store,
      clientIdKey: "host-1",
      backoff: exponentialBackoff({ initialMs: 50, maxMs: 200, jitter: 0 }),
    });
    try {
      await client.open();
      const idBefore = client.clientId;
      expect(idBefore).toBeDefined();

      // Bring down v1.
      await v1Ahp.close();
      await new Promise<void>((resolve) => v1Server.close(() => resolve()));

      // Wait until client observes the disconnect and enters reconnecting.
      const deadline = Date.now() + 2_000;
      while (client.state === "open") {
        if (Date.now() > deadline) {
          throw new Error("client did not observe disconnect");
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(["reconnecting", "connecting"]).toContain(client.state);

      // Bring up v2 on the SAME port.
      const v2Server = createServer();
      await new Promise<void>((resolve) => v2Server.listen(port, "127.0.0.1", resolve));
      const v2Connections: AhpServerConnection[] = [];
      const v2Ahp = new AhpServerSocket({
        server: v2Server,
        powerlineToken: "tok",
        onInitialize: () => INIT_RESULT,
        onConnection: (c) => v2Connections.push(c),
      });
      try {
        // Wait until client is back open against v2.
        const deadline2 = Date.now() + 5_000;
        while (client.state !== "open") {
          if (Date.now() > deadline2) {
            throw new Error(`client did not reconnect; state=${client.state}`);
          }
          await new Promise((r) => setTimeout(r, 20));
        }
        // queueMicrotask onConnection may need another tick.
        await new Promise((r) => setImmediate(r));
        expect(v2Connections).toHaveLength(1);
        expect(v2Connections[0]?.clientId).toBe(idBefore);
        expect(client.clientId).toBe(idBefore);
      } finally {
        await v2Ahp.close();
        await new Promise<void>((resolve) => v2Server.close(() => resolve()));
      }
    } finally {
      await client.close();
    }
  });
});
