import { randomUUID, randomBytes, createHash } from "node:crypto";
import { logger } from "./logger.js";

/** Time-to-live for authorization codes: 30 seconds. */
const AUTH_CODE_TTL_MS: number = 30 * 1000;

/** Time-to-live for refresh tokens: 30 days. */
const REFRESH_TOKEN_TTL_MS: number = 30 * 24 * 60 * 60 * 1000;

/** Interval at which expired OAuth state is cleaned up. */
const CLEANUP_INTERVAL_MS: number = 60 * 1000;

/** Byte length of generated tokens (authorization codes, refresh tokens). */
const TOKEN_BYTE_LENGTH: number = 32;

// ─── Client Registration ──────────────────────────────────────────────

interface ClientRecord {
  clientId: string;
  redirectUris: string[];
  clientName: string;
  createdAt: number;
}

/** Registered OAuth clients keyed by client ID. */
const clients: Map<string, ClientRecord> = new Map();

/**
 * Register a new OAuth client with dynamic client registration.
 *
 * @param redirectUris - List of allowed redirect URIs for this client.
 * @param clientName - Human-readable name for the client (optional).
 * @returns The newly registered client record.
 */
export function registerClient(redirectUris: string[], clientName?: string): ClientRecord {
  const clientId = randomUUID();
  const record: ClientRecord = {
    clientId,
    redirectUris,
    clientName: clientName || "Unknown Client",
    createdAt: Date.now(),
  };
  clients.set(clientId, record);
  logger.info({ clientId, clientName: record.clientName }, "OAuth client registered");
  return record;
}

/**
 * Look up a registered client by ID.
 *
 * @param clientId - The client ID to look up.
 * @returns The client record, or undefined if not found.
 */
export function getClient(clientId: string): ClientRecord | undefined {
  return clients.get(clientId);
}

// ─── Authorization Codes ──────────────────────────────────────────────

interface AuthCodeRecord {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  createdAt: number;
  expiresAt: number;
}

/** Active authorization codes keyed by code string. */
const authCodes: Map<string, AuthCodeRecord> = new Map();

/**
 * Create a single-use authorization code bound to the given parameters.
 *
 * @param clientId - The client that requested authorization.
 * @param redirectUri - The redirect URI for this authorization.
 * @param codeChallenge - PKCE S256 code challenge.
 * @param resource - The resource URL the client wants to access.
 * @returns The generated authorization code string.
 */
export function createAuthorizationCode(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  resource: string,
): string {
  const code = randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
  const now = Date.now();
  const record: AuthCodeRecord = {
    code,
    clientId,
    redirectUri,
    codeChallenge,
    resource,
    createdAt: now,
    expiresAt: now + AUTH_CODE_TTL_MS,
  };
  authCodes.set(code, record);
  logger.info({ clientId }, "Authorization code created");
  return code;
}

/**
 * Compute the S256 code challenge from a code verifier.
 *
 * @param codeVerifier - The PKCE code verifier string.
 * @returns The base64url-encoded SHA-256 hash.
 */
export function computeCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/**
 * Verify that a code verifier matches a code challenge using S256.
 *
 * @param codeVerifier - The PKCE code verifier from the token request.
 * @param codeChallenge - The code challenge stored at authorization time.
 * @returns True if the verifier matches the challenge.
 */
export function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const computed = computeCodeChallenge(codeVerifier);
  return computed === codeChallenge;
}

/**
 * Consume an authorization code, validating all parameters.
 *
 * The code is deleted regardless of whether validation succeeds (single-use).
 *
 * @param code - The authorization code to consume.
 * @param clientId - The client ID making the token request.
 * @param redirectUri - The redirect URI from the token request.
 * @param codeVerifier - The PKCE code verifier.
 * @param resource - The resource URL from the token request.
 * @returns The auth code record if valid, or undefined.
 */
export function consumeAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  resource: string,
): AuthCodeRecord | undefined {
  const record = authCodes.get(code);
  // Always delete to prevent replay — even if validation fails
  authCodes.delete(code);

  if (!record) {
    return undefined;
  }

  const now = Date.now();
  if (now > record.expiresAt) {
    return undefined;
  }

  if (record.clientId !== clientId) {
    return undefined;
  }

  if (record.redirectUri !== redirectUri) {
    return undefined;
  }

  if (record.resource !== resource) {
    return undefined;
  }

  if (!verifyCodeChallenge(codeVerifier, record.codeChallenge)) {
    return undefined;
  }

  return record;
}

// ─── Refresh Tokens ───────────────────────────────────────────────────

interface RefreshTokenRecord {
  token: string;
  clientId: string;
  resource: string;
  createdAt: number;
  expiresAt: number;
}

/** Active refresh tokens keyed by token string. */
const refreshTokens: Map<string, RefreshTokenRecord> = new Map();

/**
 * Create a new refresh token for the given client and resource.
 *
 * @param clientId - The client this refresh token is issued to.
 * @param resource - The resource URL this refresh token is scoped to.
 * @returns The generated refresh token string.
 */
export function createRefreshToken(clientId: string, resource: string): string {
  const token = randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
  const now = Date.now();
  refreshTokens.set(token, {
    token,
    clientId,
    resource,
    createdAt: now,
    expiresAt: now + REFRESH_TOKEN_TTL_MS,
  });
  return token;
}

/**
 * Consume a refresh token with rotation — the old token is invalidated and
 * a new one must be issued in its place.
 *
 * @param token - The refresh token to consume.
 * @param clientId - The client ID making the refresh request.
 * @returns The refresh token record if valid, or undefined.
 */
export function consumeRefreshToken(token: string, clientId: string): RefreshTokenRecord | undefined {
  const record = refreshTokens.get(token);
  // Always delete to enforce rotation
  refreshTokens.delete(token);

  if (!record) {
    return undefined;
  }

  const now = Date.now();
  if (now > record.expiresAt) {
    return undefined;
  }

  if (record.clientId !== clientId) {
    return undefined;
  }

  return record;
}

// ─── Cleanup ──────────────────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | undefined;

/** Start the periodic OAuth state cleanup timer. Call once on server startup. */
export function startOAuthCleanup(): void {
  if (cleanupTimer) {
    return;
  }
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [code, record] of authCodes) {
      if (now > record.expiresAt) {
        authCodes.delete(code);
      }
    }
    for (const [token, record] of refreshTokens) {
      if (now > record.expiresAt) {
        refreshTokens.delete(token);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

/** Stop the periodic OAuth state cleanup timer. */
export function stopOAuthCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

/** Clear all OAuth state. Intended for testing only. */
export function clearOAuthState(): void {
  clients.clear();
  authCodes.clear();
  refreshTokens.clear();
}
