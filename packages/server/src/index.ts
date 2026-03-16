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
import { createSession, validateSessionCookie } from "./session.js";
import { startSessionCleanup, stopSessionCleanup } from "./session.js";
import { generatePairingCode, redeemPairingCode, startPairingCleanup, stopPairingCleanup } from "./pairing.js";
import { logger } from "./logger.js";
import { exec } from "./utils/exec.js";
import { detectLanIp } from "./utils/network.js";
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

/** Minimal HTML page shown when the user needs to enter a pairing code. */
function renderPairingPage(error?: string): string {
  const errorHtml = error ? `<p style="color:#e74c3c;margin-bottom:1rem">${error}</p>` : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grackle — Pair Device</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f172a;color:#e2e8f0}
  .card{background:#1e293b;border-radius:12px;padding:2.5rem;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.3)}
  h1{font-size:1.5rem;margin-bottom:.5rem}
  p{color:#94a3b8;margin-bottom:1.5rem;font-size:.95rem}
  input{width:100%;padding:.75rem 1rem;font-size:1.25rem;letter-spacing:.3em;text-align:center;border:2px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;text-transform:uppercase;font-family:monospace}
  input:focus{outline:none;border-color:#3b82f6}
  button{margin-top:1rem;width:100%;padding:.75rem;font-size:1rem;border:none;border-radius:8px;background:#3b82f6;color:#fff;cursor:pointer;font-weight:600}
  button:hover{background:#2563eb}
</style></head><body>
<div class="card">
  <h1>Grackle</h1>
  <p>Enter the pairing code shown in your terminal.</p>
  ${errorHtml}
  <form method="GET" action="/pair">
    <input name="code" type="text" maxlength="6" pattern="[A-Za-z0-9]{6}" autocomplete="off" autofocus placeholder="ABC123" required>
    <button type="submit">Pair</button>
  </form>
</div></body></html>`;
}

/**
 * Serve a static file from the web dist directory.
 * Always writes a response (200, 403, 404, or 500).
 */
function serveStaticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawPath: string,
): boolean {
  const isRoot = rawPath === "/" || rawPath === "";
  let filePath = isRoot
    ? join(WEB_DIST_DIR, "index.html")
    : resolve(WEB_DIST_DIR, normalize(`.${rawPath}`));

  // Prevent path traversal — resolved path must stay within the dist directory
  const rel = relative(WEB_DIST_DIR, filePath);
  if (rel.startsWith("..") || resolve(WEB_DIST_DIR, rel) !== filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (!existsSync(filePath)) {
    // SPA fallback
    filePath = join(WEB_DIST_DIR, "index.html");
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return true;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
    return true;
  } catch {
    res.writeHead(500);
    res.end("Server error");
    return true;
  }
}

/** Extract the remote IP from an incoming request. */
function getRemoteIp(req: http.IncomingMessage): string {
  return req.socket.remoteAddress || "unknown";
}

/**
 * Create the HTTP request handler for the web server.
 *
 * All routes are gated by session cookie authentication.
 * The /pair endpoint handles pairing code exchange.
 */
function createWebHandler(apiKey: string): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    let rawPath: string;
    let queryString = "";
    try {
      const urlParts = (req.url || "/").split("?");
      rawPath = decodeURIComponent(urlParts[0]);
      queryString = urlParts[1] || "";
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    // --- Pairing endpoint ---
    if (rawPath === "/pair") {
      const params = new URLSearchParams(queryString);
      const code = params.get("code");

      if (code) {
        const remoteIp = getRemoteIp(req);
        if (redeemPairingCode(code, remoteIp)) {
          const setCookie = createSession(apiKey);
          res.writeHead(302, {
            Location: "/",
            "Set-Cookie": setCookie,
          });
          res.end();
          return;
        }
        // Invalid or expired code — show pairing page with error
        const html = renderPairingPage("Invalid or expired pairing code. Try again.");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      // No code provided — show the pairing form
      const html = renderPairingPage();
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    // --- All other routes require a valid session cookie ---
    const cookieHeader = req.headers.cookie || "";
    if (!validateSessionCookie(cookieHeader, apiKey)) {
      res.writeHead(302, { Location: "/pair" });
      res.end();
      return;
    }

    serveStaticFile(req, res, rawPath);
  };
}

/** Whether a bind address is a wildcard (binds all interfaces). */
function isWildcardAddress(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "0:0:0:0:0:0:0:0";
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
    .catch((err: unknown) => {
      const isNotFound =
        err instanceof Error &&
        ("code" in err
          ? (err as Error & { code: unknown }).code === "ENOENT"
          : err.message.includes("ENOENT"));
      if (isNotFound) {
        logger.warn(
          "GitHub CLI (gh) not found on PATH — codespace features will be unavailable. Install from https://cli.github.com/",
        );
      } else {
        logger.warn(
          { err },
          "GitHub CLI (gh) availability check failed — codespace features may not work",
        );
      }
    });

  // Start heartbeat
  startHeartbeat((environmentId) => {
    updateEnvironmentStatus(environmentId, "disconnected");
    broadcastEnvironments();
  });

  // Start periodic cleanup timers
  startPairingCleanup();
  startSessionCleanup();

  // --- gRPC server (HTTP/2) ---
  const grpcPort = parseInt(process.env.GRACKLE_PORT || String(DEFAULT_SERVER_PORT), 10);
  const bindHost = process.env.GRACKLE_HOST || "127.0.0.1";
  const allowNetwork = isWildcardAddress(bindHost);

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

  createWsBridge(webServer, verifyApiKey, (cookieHeader: string) =>
    validateSessionCookie(cookieHeader, apiKey),
  );

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

    // Generate initial pairing code and print to terminal
    const code = generatePairingCode();
    if (code) {
      const pairingHost = isWildcardAddress(bindHost)
        ? (detectLanIp() || "localhost")
        : bindHost;
      const pairingUrl = `http://${pairingHost}:${webPort}/pair?code=${code}`;

      process.stdout.write("\n");
      process.stdout.write("  Open in browser:\n");
      process.stdout.write(`  ${pairingUrl}\n`);
      process.stdout.write("\n");

      // Print QR code only when network-accessible (useful for phone scanning)
      if (allowNetwork) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const qrcode = esmRequire("qrcode") as { toString(text: string, opts: { type: string; small: boolean }): Promise<string> };
          qrcode.toString(pairingUrl, { type: "terminal", small: true })
            .then((qr: string) => { process.stdout.write(qr); })
            .catch(() => { /* QR rendering failed — not critical */ });
        } catch {
          // qrcode not installed — skip QR
        }
      }

      process.stdout.write("  Pairing code expires in 5 minutes.\n");
      process.stdout.write("  Run `grackle pair` to generate a new code.\n");
      process.stdout.write("\n");

      logger.info({ url: pairingUrl }, "Pairing URL generated");

    }
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
    stopPairingCleanup();
    stopSessionCleanup();
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

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.on("SIGINT", shutdown);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.on("SIGTERM", shutdown);
}

main();
