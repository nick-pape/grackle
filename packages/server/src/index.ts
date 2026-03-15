import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ConnectError, Code } from "@connectrpc/connect";
import http2 from "node:http2";
import http from "node:http";
import { registerGrackleRoutes } from "./grpc-service.js";
import { registerAdapter, startHeartbeat } from "./adapter-manager.js";
import { updateEnvironmentStatus, resetAllStatuses } from "./env-registry.js";
import { broadcastEnvironments } from "./ws-broadcast.js";
import { DockerAdapter } from "./adapters/docker.js";
import { LocalAdapter } from "./adapters/local.js";
import { SshAdapter } from "./adapters/ssh.js";
import { CodespaceAdapter } from "./adapters/codespace.js";
import { closeAllTunnels } from "./adapters/remote-adapter-utils.js";
import { createWsBridge } from "./ws-bridge.js";
import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT, DEFAULT_MCP_PORT } from "@grackle-ai/common";
import { createMcpServer } from "@grackle-ai/mcp";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize, resolve, relative } from "node:path";
import { createRequire } from "node:module";
import { loadOrCreateApiKey, verifyApiKey } from "./api-key.js";
import { logger } from "./logger.js";
import { exec } from "./utils/exec.js";

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
    let rawPath: string;
    try {
      rawPath = decodeURIComponent((req.url || "/").split("?")[0]);
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }
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

  // Non-blocking startup diagnostic: check gh CLI availability
  const GH_CHECK_TIMEOUT_MS: number = 5_000;
  exec("gh", ["version"], { timeout: GH_CHECK_TIMEOUT_MS })
    .then((result) => {
      logger.info(
        { version: result.stdout.split("\n")[0] },
        "GitHub CLI available",
      );
    })
    .catch(() => {
      logger.warn(
        "GitHub CLI (gh) not found on PATH — codespace features will be unavailable. Install from https://cli.github.com/",
      );
    });

  // Start heartbeat
  startHeartbeat((environmentId) => {
    updateEnvironmentStatus(environmentId, "disconnected");
    broadcastEnvironments();
  });

  // --- gRPC server (HTTP/2) ---
  const grpcPort = parseInt(process.env.GRACKLE_PORT || String(DEFAULT_SERVER_PORT), 10);
  const bindHost = process.env.GRACKLE_HOST || "127.0.0.1";

  /** Allowed loopback bind addresses — security policy: never expose API key to the network. */
  const ALLOWED_BIND_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "::1"]);
  if (!ALLOWED_BIND_HOSTS.has(bindHost)) {
    logger.fatal({ host: bindHost }, "GRACKLE_HOST must be a loopback address (127.0.0.1 or ::1). Got: %s", bindHost);
    process.exit(1);
  }

  /** Format bindHost for embedding in a URL — IPv6 literals need brackets per RFC 2732. */
  const urlHost = bindHost.includes(":") ? `[${bindHost}]` : bindHost;
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

  grpcServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal({ port: grpcPort }, "Port %d is already in use. Is another Grackle server running?", grpcPort);
    } else {
      logger.fatal({ err }, "gRPC server error");
    }
    process.exitCode = 1;
    shutdown().catch(() => { process.exit(1); });
  });

  grpcServer.listen(grpcPort, bindHost, () => {
    logger.info({ port: grpcPort, host: bindHost }, "gRPC server listening on http://%s:%d", urlHost, grpcPort);
  });

  // --- Web + WebSocket server (HTTP/1.1) ---
  const webPort = parseInt(process.env.GRACKLE_WEB_PORT || String(DEFAULT_WEB_PORT), 10);
  const webServer = http.createServer(createWebHandler(apiKey));

  createWsBridge(webServer, verifyApiKey);

  webServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal({ port: webPort }, "Port %d is already in use. Is another Grackle server running?", webPort);
    } else {
      logger.fatal({ err }, "Web server error");
    }
    process.exitCode = 1;
    shutdown().catch(() => { process.exit(1); });
  });

  webServer.listen(webPort, bindHost, () => {
    logger.info({ port: webPort, host: bindHost }, "Web UI + WebSocket on http://%s:%d", urlHost, webPort);
  });

  // --- MCP server (HTTP/1.1, Streamable HTTP) ---
  const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const mcpServer = createMcpServer({ bindHost, mcpPort, grpcPort, apiKey });

  mcpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal({ port: mcpPort }, "Port %d is already in use. Is another Grackle server running?", mcpPort);
    } else {
      logger.fatal({ err }, "MCP server error");
    }
    process.exitCode = 1;
    shutdown().catch(() => { process.exit(1); });
  });

  mcpServer.listen(mcpPort, bindHost, () => {
    logger.info({ port: mcpPort, host: bindHost }, "MCP server on http://%s:%d/mcp", urlHost, mcpPort);
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

    await new Promise<void>((resolve) => {
      mcpServer.close((err?: Error) => {
        if (err) {
          logger.error({ err }, "Error while closing MCP server");
        }
        resolve();
      });
    });

    clearTimeout(forceExit);
    process.exit(process.exitCode || 0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
