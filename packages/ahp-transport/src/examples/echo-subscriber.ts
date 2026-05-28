/**
 * Echo subscriber — minimal end-to-end example that exercises the public
 * `@grackle-ai/ahp-transport` surface (`JsonRpcSession`, `AhpServerSocket`,
 * `AhpClientSocket`, `ClientIdStore`) for a realistic workflow:
 *
 * - Server hosts a single "echo" session. When a client subscribes to
 *   `ahp-session:/echo`, the server fires a sequence of `action`
 *   notifications back to the client.
 * - Client connects, subscribes (via a `subscribe` JSON-RPC request, even
 *   though the framing layer doesn't formally route by channel — `MultiHost
 *   Client` in HR8b will), and collects every received notification.
 *
 * This file is not exported from the package barrel. It's referenced from
 * `examples.integration.test.ts` to confirm the public API composes
 * without requiring consumers to reach into internals.
 */

import type { AhpRequest, AhpResponse, InitializeParams, InitializeResult } from "@grackle-ai/ahp";
import { JsonRpcErrorCodes } from "@grackle-ai/ahp";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { AhpClientSocket } from "../ahp-client-socket.js";
import { InMemoryClientIdStore } from "../client-id-store.js";
import {
  AhpServerSocket,
  type AhpServerConnection,
  type AhpServerSocketOptions,
} from "../ahp-server-socket.js";

const INIT_RESULT: InitializeResult = {
  protocolVersion: "0.1.0",
  serverSeq: 0,
  snapshots: [],
};

/**
 * Spawn an echo subscriber: a server that emits `count` `action`
 * notifications to any client that issues a `subscribe` JSON-RPC request,
 * paired with a client that connects, subscribes, and returns the
 * collected actions.
 *
 * Returns a `dispose()` that tears everything down.
 */
export async function runEchoSubscriber(count: number): Promise<{
  received: unknown[];
  dispose: () => Promise<void>;
}> {
  // ── Server ──────────────────────────────────────────────────────
  const server: Server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  const subscribers: AhpServerConnection[] = [];
  const handleRequest: NonNullable<AhpServerSocketOptions["onRequest"]> = async (
    req: AhpRequest,
    conn: AhpServerConnection,
  ): Promise<AhpResponse> => {
    if (req.method === "subscribe") {
      // Register this connection as a subscriber and fan out `count`
      // notifications AFTER the response is on the wire. The afterSend
      // primitive in the framing layer is exposed via the request handler's
      // wrapped return; here we use a plain response and a microtask
      // because the example demonstrates the *consumer* surface.
      subscribers.push(conn);
      queueMicrotask(() => {
        for (let i = 0; i < count; i++) {
          conn.session.notify("action", {
            channel: "ahp-session:/echo",
            serverSeq: i + 1,
            action: { type: "echo/tick", payload: { i } },
          });
        }
      });
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: { channel: "ahp-session:/echo", snapshot: undefined },
      };
    }
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code: JsonRpcErrorCodes.MethodNotFound, message: `no handler for ${req.method}` },
    };
  };

  const ahp = new AhpServerSocket({
    server,
    powerlineToken: "echo-token",
    onInitialize: (_params: InitializeParams) => INIT_RESULT,
    onRequest: handleRequest,
  });

  // ── Client ──────────────────────────────────────────────────────
  const received: unknown[] = [];
  const client = new AhpClientSocket({
    url: `ws://127.0.0.1:${port}/ahp`,
    powerlineToken: "echo-token",
    clientIdStore: new InMemoryClientIdStore(),
    clientIdKey: "echo-example",
    onNotification: (notif) => {
      if (notif.method === "action") {
        received.push(notif.params);
      }
    },
  });

  await client.open();
  await client.request("subscribe", {
    channel: "ahp-session:/echo",
  } as never);

  // Give notifications a beat to arrive.
  await new Promise((r) => setTimeout(r, 50));

  const dispose = async (): Promise<void> => {
    await client.close();
    await ahp.close();
    await new Promise<void>((r) => server.close(() => r()));
  };

  return { received, dispose };
}
