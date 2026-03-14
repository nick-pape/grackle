#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_MCP_PORT, DEFAULT_SERVER_PORT, GRACKLE_DIR, API_KEY_FILENAME } from "@grackle-ai/common";
import { createMcpServer } from "./mcp-server.js";

/** Allowed loopback bind addresses — security policy: never expose to the network. */
const ALLOWED_BIND_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "::1"]);

/** Load the API key from the default file location. */
function loadApiKey(): string {
  const grackleHome = process.env.GRACKLE_HOME
    ? join(process.env.GRACKLE_HOME, GRACKLE_DIR)
    : join(homedir(), GRACKLE_DIR);
  const keyPath = join(grackleHome, API_KEY_FILENAME);
  try {
    const key = readFileSync(keyPath, "utf8").trim();
    if (!key) {
      console.error(`Error: API key file is empty: ${keyPath}\nRun "grackle serve" first to generate a key.`);
      process.exit(1);
    }
    return key;
  } catch {
    console.error(`Error: Could not read API key from ${keyPath}\nRun "grackle serve" first to generate a key, or set GRACKLE_API_KEY.`);
    process.exit(1);
  }
}

/** Start the standalone MCP server, pointed at an already-running Grackle gRPC server. */
function main(): void {
  const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const bindHost = process.env.GRACKLE_HOST || "127.0.0.1";
  const apiKey = process.env.GRACKLE_API_KEY || loadApiKey();

  if (!ALLOWED_BIND_HOSTS.has(bindHost)) {
    console.error(`Error: GRACKLE_HOST must be a loopback address (127.0.0.1 or ::1). Got: ${bindHost}`);
    process.exit(1);
  }

  // Parse the gRPC server URL to extract host and port
  const grackleUrl = process.env.GRACKLE_URL || `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;
  let grpcPort: number;
  try {
    const parsed = new URL(grackleUrl);
    grpcPort = parseInt(parsed.port || String(DEFAULT_SERVER_PORT), 10);
  } catch {
    console.error(`Error: Invalid GRACKLE_URL: ${grackleUrl}`);
    process.exit(1);
  }

  const urlHost = bindHost.includes(":") ? `[${bindHost}]` : bindHost;

  const server = createMcpServer({ bindHost, mcpPort, grpcPort, apiKey });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Error: Port ${mcpPort} is already in use.`);
    } else {
      console.error("MCP server error:", err);
    }
    process.exit(1);
  });

  server.listen(mcpPort, bindHost, () => {
    console.log(`Grackle MCP server listening on http://${urlHost}:${mcpPort}/mcp`);
    console.log(`Connected to gRPC server at ${grackleUrl}`);
  });

  function shutdown(): void {
    console.log("Shutting down MCP server...");
    server.close(() => {
      process.exit(0);
    });
    // Force exit after 5 seconds
    setTimeout(() => {
      process.exit(1);
    }, 5000).unref();
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
