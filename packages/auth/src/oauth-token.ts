import { createHmac, timingSafeEqual } from "node:crypto";

/** Default access token time-to-live: 1 hour in milliseconds. */
export const OAUTH_ACCESS_TOKEN_TTL_MS: number = 60 * 60 * 1000;

/** Default refresh token time-to-live: 30 days in milliseconds. */
export const OAUTH_REFRESH_TOKEN_TTL_MS: number = 30 * 24 * 60 * 60 * 1000;

/** Claims embedded in an OAuth access token payload. */
export interface OAuthTokenClaims {
  /** Token type discriminator — always "oauth" for OAuth access tokens. */
  typ: "oauth";
  /** Subject — the OAuth client ID that was authorized. */
  sub: string;
  /** Audience — the resource URL (MCP server URL) this token was issued for. */
  aud: string;
  /** Issued-at time (epoch seconds). */
  iat: number;
  /** Expiry time (epoch seconds). */
  exp: number;
}

/** Encode a buffer as base64url (no padding). */
function toBase64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Decode a base64url string to a Buffer. */
function fromBase64Url(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

/** Compute HMAC-SHA256 signature over a payload string. */
function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/**
 * Create an OAuth access token with the given client ID and resource, signed with the provided secret.
 *
 * @param clientId - The OAuth client ID (subject).
 * @param resource - The resource URL (audience) this token is scoped to.
 * @param signingSecret - Secret used to HMAC-sign the token (typically the API key).
 * @param ttlMs - Token time-to-live in milliseconds (default: 1 hour).
 * @returns The signed opaque token string.
 */
export function createOAuthAccessToken(
  clientId: string,
  resource: string,
  signingSecret: string,
  ttlMs: number = OAUTH_ACCESS_TOKEN_TTL_MS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: OAuthTokenClaims = {
    typ: "oauth",
    sub: clientId,
    aud: resource,
    iat: now,
    exp: now + Math.floor(ttlMs / 1000),
  };
  const payloadStr = JSON.stringify(payload);
  const payloadEncoded = toBase64Url(Buffer.from(payloadStr, "utf8"));
  const signature = toBase64Url(sign(payloadEncoded, signingSecret));
  return `${payloadEncoded}.${signature}`;
}

/**
 * Verify an OAuth access token's signature and expiry.
 *
 * Uses constant-time comparison for the HMAC signature.
 *
 * @param token - The token string to verify.
 * @param signingSecret - The secret used to verify the HMAC signature.
 * @returns The decoded claims if valid, or `undefined` if verification fails.
 */
export function verifyOAuthAccessToken(token: string, signingSecret: string): OAuthTokenClaims | undefined {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1 || dotIndex === 0 || dotIndex === token.length - 1) {
    return undefined;
  }

  // Reject tokens with multiple dots
  if (token.indexOf(".", dotIndex + 1) !== -1) {
    return undefined;
  }

  const payloadEncoded = token.slice(0, dotIndex);
  const signatureEncoded = token.slice(dotIndex + 1);

  // Verify signature using constant-time comparison
  const expectedSignature = sign(payloadEncoded, signingSecret);
  let actualSignature: Buffer;
  try {
    actualSignature = fromBase64Url(signatureEncoded);
  } catch {
    return undefined;
  }

  if (expectedSignature.length !== actualSignature.length) {
    return undefined;
  }

  if (!timingSafeEqual(expectedSignature, actualSignature)) {
    return undefined;
  }

  // Decode and parse payload — parse as Record first for runtime validation
  let raw: Record<string, unknown>;
  try {
    const payloadStr = fromBase64Url(payloadEncoded).toString("utf8");
    raw = JSON.parse(payloadStr) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  // Validate claim types to prevent bypass via crafted payloads
  if (
    raw.typ !== "oauth" ||
    typeof raw.sub !== "string" ||
    typeof raw.aud !== "string" ||
    !Number.isFinite(raw.iat) ||
    !Number.isFinite(raw.exp)
  ) {
    return undefined;
  }

  const claims: OAuthTokenClaims = raw as unknown as OAuthTokenClaims;

  // Check expiry (exp must be strictly greater than both iat and now)
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now || claims.exp <= claims.iat) {
    return undefined;
  }

  return claims;
}
