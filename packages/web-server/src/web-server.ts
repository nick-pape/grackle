import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize, resolve, relative } from "node:path";
import { createRequire } from "node:module";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { ConnectRouter } from "@connectrpc/connect";
import {
  setSecurityHeaders,
  createSession, validateSessionCookie, verifyApiKey,
  redeemPairingCode,
  registerClient, getClient,
  createAuthorizationCode, consumeAuthorizationCode,
  createRefreshToken, consumeRefreshToken,
  createOAuthAccessToken, OAUTH_ACCESS_TOKEN_TTL_MS,
} from "@grackle-ai/auth";

// ─── Options ────────────────────────────────────────────────

/** Result of a single readiness sub-check. */
export interface ReadinessCheck {
  /** Whether this sub-check passed. */
  ok: boolean;
  /** Optional human-readable detail (e.g. error message). */
  message?: string;
}

/** Aggregated readiness probe result. */
export interface ReadinessResult {
  /** Whether all sub-checks passed. */
  ready: boolean;
  /** Individual sub-check results keyed by name (e.g. "database", "grpc"). */
  checks: Record<string, ReadinessCheck>;
}

/** Options for creating a Grackle web server. */
export interface WebServerOptions {
  /** API key for session/bearer auth. */
  apiKey: string;
  /** Port the web server will listen on (used for OAuth URL generation). */
  webPort: number;
  /** Bind host (e.g. "127.0.0.1" or "0.0.0.0"). */
  bindHost: string;
  /** ConnectRPC route registration function (injected from grpc-service). */
  connectRoutes?: (router: ConnectRouter) => void;
  /** Override the web UI dist directory (default: resolve from `grackle-ai/web`). */
  webDistDir?: string;
  /** Optional readiness probe callback. When omitted, `/readyz` returns a basic "ok". */
  readinessCheck?: () => ReadinessResult;
}

// ─── Static File Config ─────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Resolve the web UI dist directory. */
function resolveWebDistDir(): string {
  const esmRequire: NodeRequire = createRequire(import.meta.url);
  return resolve(
    process.env.GRACKLE_WEB_DIR
      || join(dirname(esmRequire.resolve("@grackle-ai/web/package.json")), "dist"),
  );
}

// ─── HTML Pages ─────────────────────────────────────────────

/** Escape HTML special characters for safe embedding in attributes and text content. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Minimal HTML page shown when the user needs to enter a pairing code. */
function renderPairingPage(error?: string): string {
  const errorHtml = error ? `<p style="color:#e74c3c;margin-bottom:1rem">${escapeHtml(error)}</p>` : "";
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
  const errorHtml = error ? `<p style="color:#e74c3c;margin-bottom:1rem">${escapeHtml(error)}</p>` : "";
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

// ─── HTTP Helpers ───────────────────────────────────────────

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
  res: http.ServerResponse,
  rawPath: string,
  distDir: string,
): void {
  const isRoot = rawPath === "/" || rawPath === "";
  let filePath = isRoot
    ? join(distDir, "index.html")
    : resolve(distDir, normalize(`.${rawPath}`));

  // Prevent path traversal — resolved path must stay within the dist directory
  const rel = relative(distDir, filePath);
  if (rel.startsWith("..") || resolve(distDir, rel) !== filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // After path traversal validation, filePath is safe to use with fs operations.
  // CodeQL flags these as "uncontrolled data in path expression" but the check
  // above guarantees the path is within distDir.
  const safeFilePath = existsSync(filePath) ? filePath : join(distDir, "index.html"); // SPA fallback

  if (!existsSync(safeFilePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = extname(safeFilePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = readFileSync(safeFilePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end("Server error");
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

// ─── Utilities ──────────────────────────────────────────────

/** Whether a bind address is a wildcard (binds all interfaces). */
export function isWildcardAddress(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "0:0:0:0:0:0:0:0";
}

// ─── Factory ────────────────────────────────────────────────

/**
 * Create an HTTP server that serves the Grackle web UI, pairing flow,
 * OAuth authorization server, and optionally proxies ConnectRPC requests.
 *
 * @param options - Server configuration.
 * @returns An `http.Server` ready to `.listen()`.
 */
export function createWebServer(options: WebServerOptions): http.Server {
  const { apiKey, webPort, bindHost, connectRoutes, webDistDir, readinessCheck } = options;
  const distDir = webDistDir ?? resolveWebDistDir();
  const allowNetwork = isWildcardAddress(bindHost);
  const dialableHost = allowNetwork ? "127.0.0.1" : bindHost;
  const urlHost = dialableHost.includes(":") ? `[${dialableHost}]` : dialableHost;
  const webBaseUrl = `http://${urlHost}:${webPort}`;

  /** ConnectRPC handler for browser gRPC calls (Connect protocol over HTTP/1.1). */
  const webConnectHandler = connectRoutes
    ? connectNodeAdapter({ routes: connectRoutes })
    : undefined;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    setSecurityHeaders(res);

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

    // --- Health / Readiness probes (no auth) ---
    if (rawPath === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (rawPath === "/readyz") {
      const result: ReadinessResult = readinessCheck
        ? readinessCheck()
        : { ready: true, checks: {} };
      const statusCode = result.ready ? 200 : 503;
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
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
              res.end(JSON.stringify({ error: "invalid_client_metadata", error_description: "redirect_uris must use http(s) on loopback (127.0.0.1, localhost, or ::1)" }));
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
          const setCookie = createSession(apiKey, { secure: allowNetwork });
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
          const setCookie = createSession(apiKey, { secure: allowNetwork });
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
      serveStaticFile(res, rawPath, distDir);
      return;
    }

    // --- All other routes require a valid session cookie or Bearer token ---
    const cookieHeader = req.headers.cookie || "";
    const authHeader = req.headers.authorization || "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
    const hasValidSession = validateSessionCookie(cookieHeader, apiKey);
    const hasValidBearer = bearerToken.length > 0 && verifyApiKey(bearerToken);

    // --- ConnectRPC routes (Connect protocol over HTTP/1.1) ---
    if (rawPath.startsWith("/grackle.Grackle/") && webConnectHandler) {
      if (!hasValidSession && !hasValidBearer) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      webConnectHandler(req, res);
      return;
    }

    if (!hasValidSession) {
      res.writeHead(302, { Location: "/pair" });
      res.end();
      return;
    }

    serveStaticFile(res, rawPath, distDir);
  };

  return http.createServer(handler);
}
