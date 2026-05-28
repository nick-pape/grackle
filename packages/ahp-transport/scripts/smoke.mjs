#!/usr/bin/env node
/* eslint-disable */
/**
 * Dev smoke harness for @grackle-ai/ahp-transport. NOT bundled in dist; NOT
 * published. Lets you eyeball a full request + notification round-trip
 * between an in-process AhpServerSocket and AhpClientSocket without
 * standing up the full Grackle stack.
 *
 * Usage:
 *   node scripts/smoke.mjs server --port 7434 --token devtoken
 *   # in another shell:
 *   node scripts/smoke.mjs client --url ws://127.0.0.1:7434/ahp --token devtoken
 */

import { createServer } from "node:http";
import { parseArgs } from "node:util";

import {
  AhpClientSocket,
  AhpServerSocket,
  InMemoryClientIdStore,
} from "../dist/index.js";

const INIT_RESULT = {
  protocolVersion: "0.1.0",
  serverSeq: 0,
  snapshots: [],
};

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    port: { type: "string", default: "7434" },
    token: { type: "string", default: "devtoken" },
    url: { type: "string" },
  },
});

const mode = positionals[0];

if (mode === "server") {
  const server = createServer();
  const ahp = new AhpServerSocket({
    server,
    powerlineToken: values.token,
    onInitialize: (params) => {
      console.log(`[server] initialize from clientId=${params.clientId}`);
      return INIT_RESULT;
    },
    onConnection: (conn) => {
      console.log(`[server] connected: ${conn.clientId}`);
      // Demo: emit one "action" notification after init.
      setTimeout(() => {
        conn.session.notify("action", {
          channel: "ahp-session:/demo",
          serverSeq: 1,
          action: { type: "demo/hello", payload: { from: "server" } },
        });
      }, 100);
    },
    onRequest: async (req) => {
      console.log(`[server] request: ${req.method}`);
      return { jsonrpc: "2.0", id: req.id, result: null };
    },
  });
  const port = Number(values.port);
  server.listen(port, "127.0.0.1", () => {
    console.log(`[server] listening on ws://127.0.0.1:${port}/ahp`);
  });
  process.on("SIGINT", async () => {
    console.log("[server] shutting down");
    await ahp.close();
    server.close(() => process.exit(0));
  });
} else if (mode === "client") {
  const url = values.url ?? "ws://127.0.0.1:7434/ahp";
  const client = new AhpClientSocket({
    url,
    powerlineToken: values.token,
    clientIdStore: new InMemoryClientIdStore(),
    clientIdKey: "smoke",
    onStateChange: (s) => console.log(`[client] state → ${s}`),
    onNotification: (n) => console.log(`[client] notification: ${n.method}`),
  });
  try {
    const result = await client.open();
    console.log(`[client] handshake result:`, result);
    console.log(`[client] sending ping`);
    const r = await client.request("ping", { channel: "ahp-root://" });
    console.log(`[client] ping result:`, r);
    // Wait briefly for any inbound notifications then exit.
    await new Promise((r) => setTimeout(r, 300));
    await client.close();
  } catch (err) {
    console.error("[client] error:", err);
    process.exitCode = 1;
  }
} else {
  console.error("usage: node scripts/smoke.mjs <server|client> [--port N] [--token X] [--url U]");
  process.exit(1);
}
