import { connectNodeAdapter } from "@connectrpc/connect-node";
import { ConnectError, Code } from "@connectrpc/connect";
import http2 from "node:http2";
import http from "node:http";
import { registerGrackleRoutes } from "./grpc-service.js";
import { registerAdapter, startHeartbeat } from "./adapter-manager.js";
import { updateEnvironmentStatus, resetAllStatuses } from "./env-registry.js";
import { initWsSubscriber } from "./ws-broadcast.js";
import { initSigchldSubscriber } from "./signals/sigchld.js";
import { emit } from "./event-bus.js";
import { DockerAdapter } from "./adapters/docker.js";
import { LocalAdapter } from "./adapters/local.js";
import { SshAdapter } from "./adapters/ssh.js";
import { CodespaceAdapter } from "./adapters/codespace.js";
import { closeAllTunnels, reconnectOrProvision } from "@grackle-ai/adapter-sdk";
import { createWsBridge, startTaskSession } from "./ws-bridge.js";
import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT, DEFAULT_MCP_PORT, DEFAULT_POWERLINE_PORT, ROOT_TASK_ID } from "@grackle-ai/common";
import { startLocalPowerLine, type LocalPowerLineHandle } from "./local-powerline.js";
import * as adapterManager from "./adapter-manager.js";
import * as envRegistry from "./env-registry.js";
import * as tokenBroker from "./token-broker.js";
import { createMcpServer } from "@grackle-ai/mcp";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize, resolve, relative } from "node:path";
import { createRequire } from "node:module";
import { loadOrCreateApiKey, verifyApiKey } from "./api-key.js";
import { createSession, validateSessionCookie } from "./session.js";
import { startSessionCleanup, stopSessionCleanup } from "./session.js";
import { generatePairingCode, redeemPairingCode, startPairingCleanup, stopPairingCleanup } from "./pairing.js";
import {
  registerClient, getClient,
  createAuthorizationCode, consumeAuthorizationCode,
  createRefreshToken, consumeRefreshToken,
  startOAuthCleanup, stopOAuthCleanup,
} from "./oauth.js";
import { createOAuthAccessToken, OAUTH_ACCESS_TOKEN_TTL_MS } from "@grackle-ai/mcp";
import { logger } from "./logger.js";
import { exec } from "./utils/exec.js";
import { detectLanIp } from "./utils/network.js";
import { openDatabase, initDatabase } from "./db.js";

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

/** Shared card styles used by both pairing and authorize pages. */
const CARD_STYLES: string = `*{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f172a;color:#e2e8f0}
  .card{background:#1e293b;border-radius:12px;padding:2.5rem;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.3)}
  h1{font-size:1.5rem;margin-bottom:.5rem}
  p{color:#94a3b8;margin-bottom:1.5rem;font-size:.95rem}
  input{width:100%;padding:.75rem 1rem;font-size:1.25rem;letter-spacing:.3em;text-align:center;border:2px solid #334155;border-radius:8px;background:#0f172a;color:#e2e8f0;text-transform:uppercase;font-family:monospace;margin-bottom:.5rem}
  input:focus{outline:none;border-color:#3b82f6}
  button{margin-top:1rem;width:100%;padding:.75rem;font-size:1rem;border:none;border-radius:8px;background:#3b82f6;color:#fff;cursor:pointer;font-weight:600}
  button:hover{background:#2563eb}
  .btn-deny{background:#475569;margin-top:.5rem}
  .btn-deny:hover{background:#334155}
  .client-name{color:#3b82f6;font-weight:600}`;

/**
 * Render the OAuth authorize page.
 *
 * If the user has a valid session, shows a simple "Authorize" / "Deny" form.
 * If not paired, adds a pairing code input so the user can pair and authorize in one step.
 */
function renderAuthorizePage(
  clientName: string,
  oauthParams: string,
  hasPairedSession: boolean,
  error?: string,
): string {
  const errorHtml = error ? `<p style="color:#e74c3c;margin-bottom:1rem">${error}</p>` : "";
  const pairingField = hasPairedSession
    ? ""
    : `<p>Enter the pairing code shown in your terminal to pair and authorize.</p>
       <input name="pairing_code" type="text" maxlength="6" pattern="[A-Za-z0-9]{6}" autocomplete="off" autofocus placeholder="ABC123" required>`;
  const buttonLabel = hasPairedSession ? "Authorize" : "Pair &amp; Authorize";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grackle — Authorize MCP Client</title>
<style>${CARD_STYLES}</style></head><body>
<div class="card">
  <h1>Authorize MCP Client</h1>
  <p><span class="client-name">${escapeHtml(clientName)}</span> wants to connect to Grackle.</p>
  ${errorHtml}
  <form method="POST" action="/authorize">
    ${pairingField}
    <input type="hidden" name="oauth_params" value="${escapeHtml(oauthParams)}">
    <button type="submit" name="action" value="approve">${buttonLabel}</button>
    <button type="submit" name="action" value="deny" class="btn-deny">Deny</button>
  </form>
</div></body></html>`;
}

/** Escape HTML special characters for safe embedding in attributes and text content. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Maximum size for form/JSON request bodies: 16 KB. */
const MAX_BODY_SIZE: number = 16_384;

/**
 * Read the raw body string from an HTTP request with size limit enforcement.
 *
 * @param req - The incoming HTTP request.
 * @returns The raw body as a UTF-8 string.
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize: number = 0;
    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

/**
 * Parse a URL-encoded form body from an HTTP request.
 *
 * @param req - The incoming HTTP request.
 * @returns Parsed key-value pairs from the form body.
 */
async function parseFormBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  const raw = await readBody(req);
  return new URLSearchParams(raw);
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

/** Static assets served without session authentication (favicons, manifest, logo). */
const PUBLIC_ASSETS: Set<string> = new Set([
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/manifest.json",
  "/icon-192x192.png",
  "/icon-512x512.png",
  "/grackle-logo.png",
]);

/**
 * Create the HTTP request handler for the web server.
 *
 * Serves OAuth authorization server endpoints (no auth),
 * the pairing endpoint, and session-gated static files.
 */
function createWebHandler(
  apiKey: string,
  webPort: number,
  bindHost: string,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  /** Map wildcard bind hosts to a dialable host for OAuth URLs. */
  const dialableHost = isWildcardAddress(bindHost) ? "127.0.0.1" : bindHost;
  const urlHost = dialableHost.includes(":") ? `[${dialableHost}]` : dialableHost;
  const webBaseUrl = `http://${urlHost}:${webPort}`;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
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

    // --- OAuth Authorization Server Metadata (no auth) ---
    if (rawPath === "/.well-known/oauth-authorization-server") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        issuer: webBaseUrl,
        authorization_endpoint: `${webBaseUrl}/authorize`,
        token_endpoint: `${webBaseUrl}/token`,
        registration_endpoint: `${webBaseUrl}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      }));
      return;
    }

    // --- Dynamic Client Registration (no auth, JSON body) ---
    if (rawPath === "/register" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as { redirect_uris?: string[]; client_name?: string };
        const redirectUris = parsed.redirect_uris;
        const clientName = parsed.client_name;

        if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request", error_description: "redirect_uris is required" }));
          return;
        }

        // Validate each redirect URI — only allow http(s) on loopback to prevent open redirects
        for (const uri of redirectUris) {
          try {
            const parsed = new URL(uri);
            const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
            const isHttpOrHttps = parsed.protocol === "http:" || parsed.protocol === "https:";
            if (!isLoopback || !isHttpOrHttps) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "invalid_client_metadata", error_description: "redirect_uris must use http(s) on loopback (127.0.0.1 or localhost)" }));
              return;
            }
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_client_metadata", error_description: "Invalid redirect_uri" }));
            return;
          }
        }

        const client = registerClient(redirectUris, clientName);
        if (!client) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "temporarily_unavailable", error_description: "Too many registered clients" }));
          return;
        }
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          client_id: client.clientId,
          redirect_uris: client.redirectUris,
          client_name: client.clientName,
        }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // --- OAuth Authorize (GET — render page, no auth required) ---
    if (rawPath === "/authorize" && req.method === "GET") {
      const params = new URLSearchParams(queryString);
      const clientId = params.get("client_id") || "";
      const responseType = params.get("response_type") || "";
      const redirectUri = params.get("redirect_uri") || "";
      const codeChallenge = params.get("code_challenge") || "";
      const codeChallengeMethod = params.get("code_challenge_method") || "";
      const state = params.get("state") || "";
      const resource = params.get("resource") || "";

      // Validate required params
      if (responseType !== "code") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unsupported_response_type" }));
        return;
      }

      if (!clientId || !redirectUri || !codeChallenge) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request", error_description: "Missing required parameters" }));
        return;
      }

      if (codeChallengeMethod && codeChallengeMethod !== "S256") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request", error_description: "Only S256 code challenge method is supported" }));
        return;
      }

      const client = getClient(clientId);
      if (!client) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request", error_description: "Unknown client_id" }));
        return;
      }

      if (!client.redirectUris.includes(redirectUri)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request", error_description: "redirect_uri not registered" }));
        return;
      }

      // Serialize OAuth params for the hidden form field
      const oauthParams = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        state,
        resource,
      }).toString();

      const cookieHeader = req.headers.cookie || "";
      const hasPairedSession = validateSessionCookie(cookieHeader, apiKey);

      const html = renderAuthorizePage(client.clientName, oauthParams, hasPairedSession);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    // --- OAuth Authorize (POST — process approval/denial) ---
    if (rawPath === "/authorize" && req.method === "POST") {
      try {
        const formData = await parseFormBody(req);
        const action = formData.get("action") || "";
        const oauthParamsStr = formData.get("oauth_params") || "";
        const pairingCode = formData.get("pairing_code") || "";

        const oauthParams = new URLSearchParams(oauthParamsStr);
        const clientId = oauthParams.get("client_id") || "";
        const redirectUri = oauthParams.get("redirect_uri") || "";
        const codeChallenge = oauthParams.get("code_challenge") || "";
        const state = oauthParams.get("state") || "";
        const resource = oauthParams.get("resource") || "";

        // Validate client and redirect URI before any redirect to prevent open redirect
        const client = getClient(clientId);
        if (!client?.redirectUris.includes(redirectUri)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }

        // Build redirect URL using URL API to safely merge query params
        const buildRedirect = (params: Record<string, string>): string => {
          const url = new URL(redirectUri);
          for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
          }
          if (state) {
            url.searchParams.set("state", state);
          }
          return url.toString();
        };

        // Deny action
        if (action === "deny") {
          res.writeHead(302, { Location: buildRedirect({ error: "access_denied" }) });
          res.end();
          return;
        }

        // Check session — if no session, require pairing code
        const cookieHeader = req.headers.cookie || "";
        let hasPairedSession = validateSessionCookie(cookieHeader, apiKey);
        const responseHeaders: Record<string, string | string[]> = {};

        if (!hasPairedSession) {
          if (!pairingCode) {
            const html = renderAuthorizePage(
              client.clientName, oauthParamsStr, false, "Pairing code is required.",
            );
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(html);
            return;
          }

          const remoteIp = getRemoteIp(req);
          if (!redeemPairingCode(pairingCode, remoteIp)) {
            const html = renderAuthorizePage(
              client.clientName, oauthParamsStr, false, "Invalid or expired pairing code.",
            );
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(html);
            return;
          }

          // Pairing succeeded — also create a browser session
          const setCookie = createSession(apiKey);
          responseHeaders["Set-Cookie"] = setCookie;
          hasPairedSession = true;
        }

        // Approved — create authorization code
        const authCode = createAuthorizationCode(clientId, redirectUri, codeChallenge, resource);
        const redirectUrl = buildRedirect({ code: authCode });

        res.writeHead(302, {
          ...responseHeaders,
          Location: redirectUrl,
        });
        res.end();
      } catch {
        res.writeHead(400);
        res.end("Bad Request");
      }
      return;
    }

    // --- OAuth Token endpoint ---
    if (rawPath === "/token" && req.method === "POST") {
      try {
        const formData = await parseFormBody(req);
        const grantType = formData.get("grant_type") || "";

        if (grantType === "authorization_code") {
          const code = formData.get("code") || "";
          const clientId = formData.get("client_id") || "";
          const redirectUri = formData.get("redirect_uri") || "";
          const codeVerifier = formData.get("code_verifier") || "";
          const resource = formData.get("resource") || "";

          const authCodeRecord = consumeAuthorizationCode(code, clientId, redirectUri, codeVerifier, resource);
          if (!authCodeRecord) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_grant" }));
            return;
          }

          const accessToken = createOAuthAccessToken(clientId, resource, apiKey);
          const refreshToken = createRefreshToken(clientId, resource);

          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000),
            refresh_token: refreshToken,
          }));
          return;
        }

        if (grantType === "refresh_token") {
          const refreshToken = formData.get("refresh_token") || "";
          const clientId = formData.get("client_id") || "";

          const refreshRecord = consumeRefreshToken(refreshToken, clientId);
          if (!refreshRecord) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_grant" }));
            return;
          }

          const accessToken = createOAuthAccessToken(clientId, refreshRecord.resource, apiKey);
          const newRefreshToken = createRefreshToken(clientId, refreshRecord.resource);

          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000),
            refresh_token: newRefreshToken,
          }));
          return;
        }

        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
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

    // --- Public static assets (favicons, manifest) — no session required ---
    if (PUBLIC_ASSETS.has(rawPath)) {
      serveStaticFile(req, res, rawPath);
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

/** Handle for the auto-started local PowerLine child process. */
let localPowerLineHandle: LocalPowerLineHandle | undefined;

async function main(): Promise<void> {
  // Open the database and run migrations before anything else
  openDatabase();
  const { migrationErrors } = initDatabase();
  if (migrationErrors.length > 0) {
    logger.warn(
      { migrationNames: migrationErrors.map((m) => m.name), count: migrationErrors.length },
      "Database migrations completed with %d idempotent issue(s)",
      migrationErrors.length,
    );
  }

  // Reset all environment statuses on startup — in-memory connections are lost
  resetAllStatuses();

  // Load (or generate) the API key on startup
  const apiKey = loadOrCreateApiKey();

  // Register adapters
  registerAdapter(new DockerAdapter());
  registerAdapter(new LocalAdapter());
  registerAdapter(new SshAdapter());
  registerAdapter(new CodespaceAdapter());

  // --- Auto-start local PowerLine ---
  const skipLocalPowerLine = process.env.GRACKLE_SKIP_LOCAL_POWERLINE === "1";
  const powerlinePort = parseInt(process.env.GRACKLE_POWERLINE_PORT || String(DEFAULT_POWERLINE_PORT), 10);
  const plBindHost = process.env.GRACKLE_HOST || "127.0.0.1";

  if (skipLocalPowerLine) {
    logger.info("Skipping local PowerLine auto-start (GRACKLE_SKIP_LOCAL_POWERLINE=1)");
  } else try {
    // Ensure the "local" environment exists in the database
    let localEnv = envRegistry.getEnvironment("local");
    const adapterConfig = JSON.stringify({ port: powerlinePort, host: plBindHost });

    if (localEnv) {
      // Update the adapter config to match the current port/host
      envRegistry.updateAdapterConfig("local", adapterConfig);
      localEnv = envRegistry.getEnvironment("local")!;
    } else {
      envRegistry.addEnvironment("local", "Local", "local", adapterConfig);
      localEnv = envRegistry.getEnvironment("local")!;
    }

    // Spawn the PowerLine child process
    let stoppingGracefully: boolean = false;
    localPowerLineHandle = await startLocalPowerLine({
      port: powerlinePort,
      host: plBindHost,
      token: localEnv.powerlineToken,
      onExit: (code, signal) => {
        if (stoppingGracefully) {
          return;
        }
        logger.error({ code, signal }, "Local PowerLine exited unexpectedly");
        envRegistry.updateEnvironmentStatus("local", "disconnected");
        emit("environment.changed", {});
        localPowerLineHandle = undefined;
      },
    });

    // Mark graceful shutdown so onExit doesn't log spurious errors
    const originalStop = localPowerLineHandle.stop;
    localPowerLineHandle.stop = async (): Promise<void> => {
      stoppingGracefully = true;
      await originalStop();
    };

    // Auto-provision: connect the local adapter
    const localAdapter = adapterManager.getAdapter("local")!;
    const config = JSON.parse(localEnv.adapterConfig) as Record<string, unknown>;

    envRegistry.updateEnvironmentStatus("local", "connecting");
    emit("environment.changed", {});

    for await (const event of reconnectOrProvision(
      "local",
      localAdapter,
      config,
      localEnv.powerlineToken,
      !!localEnv.bootstrapped,
    )) {
      logger.info({ stage: event.stage, progress: event.progress }, "Local env: %s", event.message);
    }

    const conn = await localAdapter.connect("local", config, localEnv.powerlineToken);
    adapterManager.setConnection("local", conn);
    // Push env-var tokens only — file tokens would just overwrite local credential
    // files (e.g. ~/.claude/credentials.json) with their own content.
    await tokenBroker.pushToEnv("local", { excludeFileTokens: true });
    envRegistry.updateEnvironmentStatus("local", "connected");
    envRegistry.markBootstrapped("local");
    emit("environment.changed", {});

    logger.info({ port: powerlinePort }, "Local environment auto-connected");

    // Auto-start the root task (process 1) now that the local env is ready.
    try {
      const rootTask = (await import("./task-store.js")).getTask(ROOT_TASK_ID);
      if (rootTask) {
        const err = await startTaskSession(undefined, rootTask, { environmentId: "local" });
        if (err) {
          logger.warn({ err }, "Root task auto-start failed");
        } else {
          logger.info("Root task auto-started");
        }
      }
    } catch (bootErr) {
      logger.warn({ err: bootErr }, "Root task auto-start failed — chat will not be available until manually started");
    }
  } catch (err) {
    // Clean up the PowerLine child if it started but provisioning/connection failed
    const failedHandle: LocalPowerLineHandle | undefined = localPowerLineHandle;
    if (failedHandle) {
      localPowerLineHandle = undefined;
      await failedHandle.stop();
    }
    envRegistry.updateEnvironmentStatus("local", "error");
    emit("environment.changed", {});

    logger.error(
      { err, port: powerlinePort },
      "Failed to start local PowerLine — local environment will not be available. Is port %d in use?",
      powerlinePort,
    );
    // Non-fatal: server continues without local env (remote envs still work)
  }

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
    emit("environment.changed", {});
  });

  // Start periodic cleanup timers
  startPairingCleanup();
  startSessionCleanup();
  startOAuthCleanup();

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
  const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
  const webServer = http.createServer(createWebHandler(apiKey, webPort, bindHost));

  createWsBridge(webServer, verifyApiKey, (cookieHeader: string) =>
    validateSessionCookie(cookieHeader, apiKey),
  );

  // Wire the event bus to forward domain events over WebSocket
  initWsSubscriber();

  // Wire SIGCHLD: notify parent tasks when child sessions reach terminal status
  initSigchldSubscriber();

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
  // Use dialable host for OAuth URLs (wildcard → 127.0.0.1)
  const dialableHost = isWildcardAddress(bindHost) ? "127.0.0.1" : bindHost;
  const dialableUrlHost = dialableHost.includes(":") ? `[${dialableHost}]` : dialableHost;
  const authServerUrl = `http://${dialableUrlHost}:${webPort}`;
  const mcpServer = createMcpServer({ bindHost, mcpPort, grpcPort, apiKey, authorizationServerUrl: authServerUrl });

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
    stopOAuthCleanup();
    const forceExit = setTimeout(() => {
      logger.warn("Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Stop the local PowerLine child process first
    const plHandle: LocalPowerLineHandle | undefined = localPowerLineHandle;
    if (plHandle) {
      localPowerLineHandle = undefined;
      await plHandle.stop();
    }

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

main().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
