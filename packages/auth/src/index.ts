// ─── Logger ─────────────────────────────────────────────────
export type { AuthLogger } from "./auth-logger.js";
export { defaultAuthLogger, setAuthLogger } from "./auth-logger.js";

// ─── API Key ────────────────────────────────────────────────
export { loadOrCreateApiKey, verifyApiKey } from "./api-key.js";

// ─── Sessions ───────────────────────────────────────────────
export {
  SESSION_COOKIE_NAME,
  createSession,
  validateSessionCookie,
  parseCookies,
  clearSessions,
  startSessionCleanup,
  stopSessionCleanup,
} from "./session.js";

// ─── Pairing ────────────────────────────────────────────────
export {
  generatePairingCode,
  redeemPairingCode,
  clearPairing,
  startPairingCleanup,
  stopPairingCleanup,
} from "./pairing.js";

// ─── OAuth (server-side state) ──────────────────────────────
export {
  registerClient,
  getClient,
  createAuthorizationCode,
  consumeAuthorizationCode,
  createRefreshToken,
  consumeRefreshToken,
  computeCodeChallenge,
  verifyCodeChallenge,
  clearOAuthState,
  startOAuthCleanup,
  stopOAuthCleanup,
} from "./oauth.js";

// ─── OAuth Access Tokens (HMAC-signed) ──────────────────────
export type { OAuthTokenClaims } from "./oauth-token.js";
export {
  OAUTH_ACCESS_TOKEN_TTL_MS,
  createOAuthAccessToken,
  verifyOAuthAccessToken,
} from "./oauth-token.js";

// ─── Scoped Tokens (HMAC-signed task tokens) ────────────────
export type { ScopedTokenClaims } from "./scoped-token.js";
export {
  createScopedToken,
  verifyScopedToken,
  revokeTask,
  isRevokedTask,
  pruneRevocations,
  clearRevocations,
} from "./scoped-token.js";

// ─── Auth Context ───────────────────────────────────────────
export type { AuthContext } from "./auth-context.js";

// ─── Auth Middleware ────────────────────────────────────────
export { authenticateMcpRequest } from "./auth-middleware.js";

// ─── Security Headers ──────────────────────────────────────
export { WEB_CONTENT_SECURITY_POLICY, setSecurityHeaders } from "./security-headers.js";
