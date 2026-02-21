#!/usr/bin/env node

import { connectNodeAdapter } from "@connectrpc/connect-node";
import http2 from "node:http2";
import { registerSidecarRoutes } from "./grpc-server.js";
import { registerRuntime } from "./runtime-registry.js";
import { StubRuntime } from "./runtimes/stub.js";
import { DEFAULT_SIDECAR_PORT } from "@grackle/common";

// Parse port from CLI args
const portArg = process.argv.find((a) => a.startsWith("--port="));
const port = portArg ? parseInt(portArg.split("=")[1], 10) : DEFAULT_SIDECAR_PORT;

// Register runtimes
registerRuntime(new StubRuntime());

// Start HTTP/2 server
const handler = connectNodeAdapter({ routes: registerSidecarRoutes });

const server = http2.createServer(handler);

server.listen(port, () => {
  console.log(`Grackle sidecar listening on http://localhost:${port}`);
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
