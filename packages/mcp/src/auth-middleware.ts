import { timingSafeEqual } from "node:crypto";
import type http from "node:http";
import type { AuthContext } from "./auth-context.js";
import { verifyOAuthAccessToken } from "./oauth-token.js";
import { isRevokedTask, verifyScopedToken } from "./scoped-token.js";

/** Expected length of API key tokens (64 hex characters). */
const API_KEY_LENGTH: number = 64;

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
 * @returns An {@link AuthContext} if authentication succeeds, or `undefined` for a 401.
 */
export function authenticateMcpRequest(req: http.IncomingMessage, apiKey: string): AuthContext | undefined {
  const authHeader = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
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
      // Use the socket's local port (server-controlled) rather than the Host header (client-controlled)
      // to prevent token replay via Host spoofing.
      // Normalize trailing slashes since clients may include them (e.g., "http://127.0.0.1:7435/").
      if (oauthClaims.aud) {
        const localPort = req.socket.localPort;
        const expectedAudience = localPort ? `http://127.0.0.1:${localPort}` : undefined;
        const normalizedAud = oauthClaims.aud.replace(/\/+$/, "");
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
      projectId: claims.pid,
      personaId: claims.per,
      taskSessionId: claims.sid,
    };
  }

  return undefined;
}
