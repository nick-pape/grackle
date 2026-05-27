import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Default channel-token time-to-live: 365 days in milliseconds.
 *
 * Channel tokens back stable external webhook URLs (e.g. pasted into n8n), so
 * they are long-lived by default; the real kill switch is grant revocation
 * (persisted), not expiry.
 */
const DEFAULT_TTL_MS: number = 365 * 24 * 60 * 60 * 1000;

/** Claims embedded in a channel-capability token payload. */
export interface ChannelTokenClaims {
  /** Channel URI this token grants access to, e.g. `grackle:/sessions/<id>`. */
  chan: string;
  /** Verbs permitted on the channel, e.g. `["send_input"]`. */
  verbs: string[];
  /** Grant ID (links the token to its persisted, revocable grant row). */
  jti: string;
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
 * Create a channel-capability token signed with the provided secret.
 *
 * The token grants a specific set of verbs on a single channel URI and is
 * bound to a grant ID (`jti`) so it can be revoked independently of expiry.
 *
 * @param claims - Channel, verbs, and grant ID. `iat`/`exp` are set automatically.
 * @param signingSecret - Secret used to HMAC-sign the token (the server API key).
 * @param ttlMs - Token time-to-live in milliseconds (default: 365 days).
 * @returns The signed opaque token string (`<payload>.<signature>`).
 */
export function createChannelToken(
  claims: Pick<ChannelTokenClaims, "chan" | "verbs" | "jti">,
  signingSecret: string,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: ChannelTokenClaims = {
    chan: claims.chan,
    verbs: [...claims.verbs],
    jti: claims.jti,
    iat: now,
    exp: now + Math.floor(ttlMs / 1000),
  };
  const payloadEncoded = toBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = toBase64Url(sign(payloadEncoded, signingSecret));
  return `${payloadEncoded}.${signature}`;
}

/**
 * Verify a channel token's signature, structure, and expiry.
 *
 * Uses constant-time comparison for the HMAC signature. Revocation is NOT
 * checked here (the in-token `jti` must be checked against the persisted,
 * revocable grant row by the caller).
 *
 * @param token - The token string to verify.
 * @param signingSecret - The secret used to verify the HMAC signature.
 * @returns The decoded claims if valid, or `undefined` if verification fails.
 */
export function verifyChannelToken(
  token: string,
  signingSecret: string,
): ChannelTokenClaims | undefined {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1 || dotIndex === 0 || dotIndex === token.length - 1) {
    return undefined;
  }
  // Reject tokens with multiple dots.
  if (token.indexOf(".", dotIndex + 1) !== -1) {
    return undefined;
  }

  const payloadEncoded = token.slice(0, dotIndex);
  const signatureEncoded = token.slice(dotIndex + 1);

  // Verify signature using constant-time comparison.
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

  // Decode and parse payload.
  let claims: ChannelTokenClaims;
  try {
    const payloadStr = fromBase64Url(payloadEncoded).toString("utf8");
    claims = JSON.parse(payloadStr) as ChannelTokenClaims;
  } catch {
    return undefined;
  }

  // Validate claim types to prevent bypass via crafted payloads.
  if (
    typeof claims.chan !== "string" ||
    !Array.isArray(claims.verbs) ||
    !claims.verbs.every((v) => typeof v === "string") ||
    typeof claims.jti !== "string" ||
    !Number.isFinite(claims.iat) ||
    !Number.isFinite(claims.exp)
  ) {
    return undefined;
  }

  // Check expiry (exp must be strictly greater than both iat and now).
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now || claims.exp <= claims.iat) {
    return undefined;
  }

  return claims;
}
