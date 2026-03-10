import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ConnectError, Code } from "@connectrpc/connect";
import http2 from "node:http2";
import http from "node:http";
import { registerGrackleRoutes } from "./grpc-service.js";
import { registerAdapter, startHeartbeat } from "./adapter-manager.js";
import { updateEnvironmentStatus, resetAllStatuses } from "./env-registry.js";
import { DockerAdapter } from "./adapters/docker.js";
import { LocalAdapter } from "./adapters/local.js";
import { SshAdapter } from "./adapters/ssh.js";
import { CodespaceAdapter } from "./adapters/codespace.js";
import { closeAllTunnels } from "./adapters/remote-adapter-utils.js";
import { createWsBridge } from "./ws-bridge.js";
import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT } from "@grackle-ai/common";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize, resolve, relative } from "node:path";
import { createRequire } from "node:module";
import { loadOrCreateApiKey, verifyApiKey } from "./api-key.js";
import { logger } from "./logger.js";

// Import db to ensure tables are created
import "./db.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Resolve the web UI dist directory once at module load time. */
const esmRequire: NodeRequire = createRequire(import.meta.url);
const WEB_DIST_DIR: string = resolve(
  process.env.GRACKLE_WEB_DIR
    || join(dirname(esmRequire.resolve("@grackle-ai/web/package.json")), "dist"),
);

function createWebHandler(apiKey: string): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const rawPath = decodeURIComponent((req.url || "/").split("?")[0]);
    // URL paths are POSIX-style; use posix separator to detect root, then resolve safely
    const isRoot = rawPath === "/" || rawPath === "";
    let filePath = isRoot
      ? join(WEB_DIST_DIR, "index.html")
      : resolve(WEB_DIST_DIR, normalize(`.${rawPath}`));

    // Prevent path traversal — resolved path must stay within the dist directory
    const rel = relative(WEB_DIST_DIR, filePath);
    if (rel.startsWith("..") || resolve(WEB_DIST_DIR, rel) !== filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!existsSync(filePath)) {
      // SPA fallback
      filePath = join(WEB_DIST_DIR, "index.html");
    }

    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    try {
      let content = readFileSync(filePath);

      // Inject API key into HTML pages — safe because only localhost can access
      if (ext === ".html") {
        const html = content.toString("utf8");
        const injected = html.replace(
          "</head>",
          `<script>window.__GRACKLE_API_KEY__="${apiKey}";</script>\n</head>`
        );
        content = Buffer.from(injected, "utf8");
      }

      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end("Server error");
    }
  };
}

function main(): void {
  // Reset all environment statuses on startup — in-memory connections are lost
  resetAllStatuses();

  // Load (or generate) the API key on startup
  const apiKey = loadOrCreateApiKey();

  // Register adapters
  registerAdapter(new DockerAdapter());
  registerAdapter(new LocalAdapter());
  registerAdapter(new SshAdapter());
  registerAdapter(new CodespaceAdapter());

  // Start heartbeat
  startHeartbeat((environmentId) => {
    updateEnvironmentStatus(environmentId, "disconnected");
  });

  // --- gRPC server (HTTP/2) ---
  const grpcPort = parseInt(process.env.GRACKLE_PORT || String(DEFAULT_SERVER_PORT), 10);
  const grpcHandler = connectNodeAdapter({
    routes: registerGrackleRoutes,
    interceptors: [
      (next) => async (req) => {
        const authHeader = req.header.get("authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!verifyApiKey(token)) {
          throw new ConnectError("Unauthorized", Code.Unauthenticated);
        }
        return next(req);
      },
    ],
  });
  const grpcServer = http2.createServer(grpcHandler);

  grpcServer.listen(grpcPort, "127.0.0.1", () => {
    logger.info({ port: grpcPort }, "gRPC server listening on http://127.0.0.1:%d", grpcPort);
  });

  // --- Web + WebSocket server (HTTP/1.1) ---
  const webPort = parseInt(process.env.GRACKLE_WEB_PORT || String(DEFAULT_WEB_PORT), 10);
  const webServer = http.createServer(createWebHandler(apiKey));

  createWsBridge(webServer, verifyApiKey);

  webServer.listen(webPort, "127.0.0.1", () => {
    logger.info({ port: webPort }, "Web UI + WebSocket on http://127.0.0.1:%d", webPort);
  });

  // Graceful shutdown with a hard timeout so upgraded WS connections don't block exit.
  const SHUTDOWN_TIMEOUT_MS: number = 5_000;

  async function shutdown(): Promise<void> {
    logger.info("Shutting down...");
    const forceExit = setTimeout(() => {
      logger.warn("Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    await closeAllTunnels();

    await new Promise<void>((resolve) => {
      grpcServer.close((err?: Error) => {
        if (err) {
          logger.error({ err }, "Error while closing gRPC server");
        }
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      webServer.close((err?: Error) => {
        if (err) {
          logger.error({ err }, "Error while closing web server");
        }
        resolve();
      });
    });

    clearTimeout(forceExit);
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
