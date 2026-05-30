import { timingSafeEqual } from "node:crypto";
import type http from "node:http";
import type { AuthContext } from "./auth-context.js";
import { verifyOAuthAccessToken } from "./oauth-token.js";
import { isRevokedTask, verifyScopedToken } from "./scoped-token.js";

/** Expected length of API key tokens (64 hex characters). */
const API_KEY_LENGTH: number = 64;

/**
 * Strip trailing `/` characters from a string with a linear scan.
 *
 * Avoids a `/\/+$/` regex, which CodeQL flags as a polynomial-ReDoS risk on
 * uncontrolled (library) input.
 */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* "/" */) {
    end--;
  }
  return value.slice(0, end);
}

/**
 * Normalize an audience URL for comparison: treat `localhost` and `127.0.0.1`
 * as equal, and ignore a single trailing slash so `http://h/` matches `http://h`.
 *
 * Crucially, any non-root path, query, or fragment is **preserved** — dropping
 * it (e.g. via `URL.origin`) would let a token minted for
 * `https://mcp.example.com/some/path` be accepted when the expected resource is
 * just `https://mcp.example.com`, weakening audience isolation. Falls back to a
 * trailing-slash-trimmed copy of the raw input when the value does not parse.
 */
function normalizeLoopback(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
    }
    // Collapse a bare "/" path to empty so origin-only audiences match with or
    // without a trailing slash; otherwise keep the path (minus a trailing slash).
    const path = parsed.pathname === "/" ? "" : stripTrailingSlashes(parsed.pathname);
    return `${parsed.origin}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return stripTrailingSlashes(url);
  }
}

/** Options for {@link authenticateMcpRequest}. */
export interface AuthenticateMcpRequestOptions {
  /**
   * Canonical resource (audience) this server is reachable as, e.g.
   * `https://mcp.example.com`. When set, an OAuth token's `aud` is validated
   * against this configured origin instead of the loopback-derived default.
   * Set it from a static, operator-provided origin (`GRACKLE_MCP_ORIGIN`) — never
   * from the request `Host` header, which a client could spoof. When unset, the
   * audience is validated against the server-controlled `http://127.0.0.1:<localPort>`.
   */
  expectedResource?: string;
}

/**
 * Authenticate an incoming MCP HTTP request.
 *
 * Supports three authentication modes:
 * 1. **API key**: A 64-character hex Bearer token compared constant-time against the server API key.
 * 2. **OAuth token**: An HMAC-signed token with `typ === "oauth"`, audience-validated against the request.
 * 3. **Scoped token**: An HMAC-signed token (contains a `.`) verified against the API key as signing secret.
 *
 * @param req - The incoming HTTP request.
 * @param apiKey - The server's API key (used for both direct comparison and as the HMAC signing secret).
 * @param options - Optional audience-validation overrides (see {@link AuthenticateMcpRequestOptions}).
 * @returns An {@link AuthContext} if authentication succeeds, or `undefined` for a 401.
 */
export function authenticateMcpRequest(
  req: http.IncomingMessage,
  apiKey: string,
  options?: AuthenticateMcpRequestOptions,
): AuthContext | undefined {
  const authHeader = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
  if (!match) {
    return undefined;
  }
  const token = match[1];
  if (token.length === 0) {
    return undefined;
  }

  // Path 1: API key authentication (fixed-length hex token)
  if (token.length === API_KEY_LENGTH && apiKey.length === API_KEY_LENGTH) {
    const a = Buffer.from(token);
    const b = Buffer.from(apiKey);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { type: "api-key" };
    }
    // Fall through — a 64-char token that doesn't match the API key is invalid
    return undefined;
  }

  // Path 2: Token with dot separator — try OAuth first, then scoped
  if (token.includes(".")) {
    // Try OAuth access token (distinguished by typ === "oauth")
    const oauthClaims = verifyOAuthAccessToken(token, apiKey);
    if (oauthClaims) {
      // Validate audience if present — when non-empty, must match this server's resource URL.
      // Empty aud is accepted because the client may omit the resource indicator (RFC 8707).
      // When an explicit resource is configured (GRACKLE_MCP_ORIGIN, e.g. behind a
      // TLS reverse proxy) validate against that static, operator-provided origin.
      // Otherwise fall back to the socket's local port (server-controlled) rather than
      // the Host header (client-controlled) to prevent token replay via Host spoofing.
      // Normalize trailing slashes and treat "localhost" as equivalent to "127.0.0.1" since
      // MCP clients may connect via either hostname.
      if (oauthClaims.aud) {
        const localPort = req.socket.localPort;
        const expectedAudience = options?.expectedResource
          ? normalizeLoopback(options.expectedResource)
          : localPort
            ? `http://127.0.0.1:${localPort}`
            : undefined;
        const normalizedAud = normalizeLoopback(oauthClaims.aud);
        if (!expectedAudience || normalizedAud !== expectedAudience) {
          return undefined;
        }
      }
      return { type: "oauth", clientId: oauthClaims.sub };
    }

    // Fall through to scoped token
    const claims = verifyScopedToken(token, apiKey);
    if (!claims) {
      return undefined;
    }
    if (isRevokedTask(claims.sub)) {
      return undefined;
    }
    return {
      type: "scoped",
      taskId: claims.sub,
      workspaceId: claims.pid || undefined,
      personaId: claims.per,
      taskSessionId: claims.sid,
    };
  }

  return undefined;
}
