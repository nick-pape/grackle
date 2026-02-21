import { connectNodeAdapter } from "@connectrpc/connect-node";
import http2 from "node:http2";
import http from "node:http";
import { registerGrackleRoutes } from "./grpc-service.js";
import { registerAdapter, startHeartbeat } from "./adapter-manager.js";
import { updateEnvironmentStatus } from "./env-registry.js";
import { DockerAdapter } from "./adapters/docker.js";
import { CodespaceAdapter } from "./adapters/codespace.js";
import { SshAdapter } from "./adapters/ssh.js";
import { createWsBridge } from "./ws-bridge.js";
import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT } from "@grackle/common";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

// Import db to ensure tables are created
import "./db.js";

// Register adapters
registerAdapter(new DockerAdapter());
registerAdapter(new CodespaceAdapter());
registerAdapter(new SshAdapter());

// Start heartbeat
startHeartbeat((envId) => {
  updateEnvironmentStatus(envId, "disconnected");
});

// --- gRPC server (HTTP/2) ---
const grpcPort = parseInt(process.env.GRACKLE_PORT || String(DEFAULT_SERVER_PORT), 10);
const grpcHandler = connectNodeAdapter({ routes: registerGrackleRoutes });
const grpcServer = http2.createServer(grpcHandler);

grpcServer.listen(grpcPort, () => {
  console.log(`Grackle gRPC server listening on http://localhost:${grpcPort}`);
});

// --- Web + WebSocket server (HTTP/1.1) ---
const webPort = parseInt(process.env.GRACKLE_WEB_PORT || String(DEFAULT_WEB_PORT), 10);

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const webServer = http.createServer((req, res) => {
  // Serve static files from @grackle/web dist
  const webDistDir = process.env.GRACKLE_WEB_DIR || join(import.meta.dirname, "../../web/dist");

  let filePath = join(webDistDir, req.url === "/" ? "index.html" : req.url || "index.html");

  if (!existsSync(filePath)) {
    // SPA fallback
    filePath = join(webDistDir, "index.html");
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end("Server error");
  }
});

// Attach WebSocket bridge
createWsBridge(webServer);

webServer.listen(webPort, () => {
  console.log(`Grackle web UI + WebSocket on http://localhost:${webPort}`);
});

// Graceful shutdown
function shutdown(): void {
  console.log("\nShutting down...");
  grpcServer.close();
  webServer.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { grpcServer, webServer };
