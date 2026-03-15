import { createHmac, timingSafeEqual } from "node:crypto";

/** Default token time-to-live: 24 hours in milliseconds. */
const DEFAULT_TTL_MS: number = 24 * 60 * 60 * 1000;

/** Claims embedded in a scoped token payload. */
export interface ScopedTokenClaims {
  /** Task ID (subject). */
  sub: string;
  /** Project ID. */
  pid: string;
  /** Persona ID. */
  per: string;
  /** Session ID. */
  sid: string;
  /** Issued-at time (epoch seconds). */
  iat: number;
  /** Expiry time (epoch seconds). */
  exp: number;
}

/** In-memory revocation set: taskId → revocation timestamp (epoch ms). */
const revokedTasks: Map<string, number> = new Map();

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
 * Create a scoped token with the given claims, signed with the provided secret.
 *
 * @param claims - Token claims (sub, pid, per, sid). iat/exp are set automatically.
 * @param signingSecret - Secret used to HMAC-sign the token (typically the API key).
 * @param ttlMs - Token time-to-live in milliseconds (default: 24 hours).
 * @returns The signed opaque token string.
 */
export function createScopedToken(
  claims: Pick<ScopedTokenClaims, "sub" | "pid" | "per" | "sid">,
  signingSecret: string,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: ScopedTokenClaims = {
    ...claims,
    iat: now,
    exp: now + Math.floor(ttlMs / 1000),
  };
  const payloadStr = JSON.stringify(payload);
  const payloadEncoded = toBase64Url(Buffer.from(payloadStr, "utf8"));
  const signature = toBase64Url(sign(payloadEncoded, signingSecret));
  return `${payloadEncoded}.${signature}`;
}

/**
 * Verify a scoped token's signature and expiry.
 *
 * Uses constant-time comparison for the HMAC signature.
 *
 * @param token - The token string to verify.
 * @param signingSecret - The secret used to verify the HMAC signature.
 * @returns The decoded claims if valid, or `undefined` if verification fails.
 */
export function verifyScopedToken(token: string, signingSecret: string): ScopedTokenClaims | undefined {
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

  // Decode and parse payload
  let claims: ScopedTokenClaims;
  try {
    const payloadStr = fromBase64Url(payloadEncoded).toString("utf8");
    claims = JSON.parse(payloadStr) as ScopedTokenClaims;
  } catch {
    return undefined;
  }

  // Validate claim types to prevent bypass via crafted payloads
  if (
    typeof claims.sub !== "string" ||
    typeof claims.pid !== "string" ||
    typeof claims.per !== "string" ||
    typeof claims.sid !== "string" ||
    !Number.isFinite(claims.iat) ||
    !Number.isFinite(claims.exp)
  ) {
    return undefined;
  }

  // Check expiry (exp must be strictly greater than both iat and now)
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now || claims.exp <= claims.iat) {
    return undefined;
  }

  return claims;
}

/**
 * Revoke all tokens for a given task ID.
 * Revoked tokens are rejected by `authenticateMcpRequest` even if not yet expired.
 */
export function revokeTask(taskId: string): void {
  revokedTasks.set(taskId, Date.now());
}

/** Check whether a task ID has been revoked. */
export function isRevokedTask(taskId: string): boolean {
  return revokedTasks.has(taskId);
}

/**
 * Remove revocation entries older than the given TTL.
 * Since expired tokens are already rejected by the `exp` check,
 * revocation entries only need to live as long as the token TTL.
 *
 * @param ttlMs - Maximum age of revocation entries in milliseconds (default: 24 hours).
 */
export function pruneRevocations(ttlMs: number = DEFAULT_TTL_MS): void {
  const cutoff = Date.now() - ttlMs;
  for (const [taskId, revokedAt] of revokedTasks) {
    if (revokedAt < cutoff) {
      revokedTasks.delete(taskId);
    }
  }
}

/**
 * Clear all revocation entries. Intended for testing only.
 * @internal
 */
export function clearRevocations(): void {
  revokedTasks.clear();
}
