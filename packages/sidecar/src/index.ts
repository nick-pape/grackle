#!/usr/bin/env node

import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ConnectError, Code } from "@connectrpc/connect";
import http2 from "node:http2";
import { registerSidecarRoutes } from "./grpc-server.js";
import { registerRuntime } from "./runtime-registry.js";
import { StubRuntime } from "./runtimes/stub.js";
import { ClaudeCodeRuntime } from "./runtimes/claude-code.js";
import { DEFAULT_SIDECAR_PORT } from "@grackle/common";

// Parse CLI args
const portArg = process.argv.find((a) => a.startsWith("--port="));
const port = portArg ? parseInt(portArg.split("=")[1], 10) : DEFAULT_SIDECAR_PORT;

const tokenArg = process.argv.find((a) => a.startsWith("--token="));
const sidecarToken = tokenArg ? tokenArg.split("=")[1] : (process.env.GRACKLE_SIDECAR_TOKEN || "");

// Register runtimes
registerRuntime(new StubRuntime());
registerRuntime(new ClaudeCodeRuntime());

// Start HTTP/2 server with optional auth
const handler = connectNodeAdapter({
  routes: registerSidecarRoutes,
  interceptors: sidecarToken
    ? [
        // Auth interceptor: verify Bearer token on every request
        (next) => async (req) => {
          const authHeader = req.header.get("authorization") || "";
          const token = authHeader.replace(/^Bearer\s+/i, "");
          if (token !== sidecarToken) {
            throw new ConnectError("Unauthorized", Code.Unauthenticated);
          }
          return next(req);
        },
      ]
    : [],
});

const server = http2.createServer(handler);

server.listen(port, () => {
  const authStatus = sidecarToken ? "authenticated" : "NO AUTH (development only)";
  console.log(`Grackle sidecar listening on http://localhost:${port} [${authStatus}]`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down sidecar...");
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
