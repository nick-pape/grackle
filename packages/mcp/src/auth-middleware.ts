import { timingSafeEqual } from "node:crypto";
import type http from "node:http";
import type { AuthContext } from "./auth-context.js";
import { isRevokedTask, verifyScopedToken } from "./scoped-token.js";

/** Expected length of API key tokens (64 hex characters). */
const API_KEY_LENGTH: number = 64;

/**
 * Authenticate an incoming MCP HTTP request.
 *
 * Supports two authentication modes:
 * 1. **API key**: A 64-character hex Bearer token compared constant-time against the server API key.
 * 2. **Scoped token**: An HMAC-signed token (contains a `.`) verified against the API key as signing secret.
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

  // Path 2: Scoped token authentication (contains a dot separator)
  if (token.includes(".")) {
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
      sessionId: claims.sid,
    };
  }

  return undefined;
}
