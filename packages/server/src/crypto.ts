import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { grackleHome } from "./paths.js";
import { logger } from "./logger.js";

const ALGORITHM: "aes-256-gcm" = "aes-256-gcm";
const IV_LENGTH: number = 12;
const TAG_LENGTH: number = 16;
const SALT_LENGTH: number = 16;
const KEY_LENGTH: number = 32;
const ITERATIONS: number = 100_000;
const MASTER_KEY_BYTE_LENGTH: number = 32;
const MASTER_KEY_FILENAME: string = "master-key";

/**
 * Load or generate the master key for token encryption. Priority:
 * 1. `GRACKLE_MASTER_KEY` env var
 * 2. Persisted random key at `$GRACKLE_HOME/.grackle/master-key`
 * 3. Generate and persist a new random key
 */
function loadMasterKey(): string {
  if (process.env.GRACKLE_MASTER_KEY) {
    return process.env.GRACKLE_MASTER_KEY;
  }

  const keyPath = join(grackleHome, MASTER_KEY_FILENAME);

  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath, "utf8").trim();
    if (key.length > 0) {
      return key;
    }
  }

  // Generate and persist a random key
  const key = randomBytes(MASTER_KEY_BYTE_LENGTH).toString("hex");
  mkdirSync(grackleHome, { recursive: true });
  writeFileSync(keyPath, key + "\n", { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch { /* Windows may not support this */ }
  logger.warn("Generated new master key for token encryption. Set GRACKLE_MASTER_KEY env var for explicit control.");

  return key;
}

let cachedMasterKey: string | undefined = undefined;

function getMasterKey(): string {
  if (!cachedMasterKey) {
    cachedMasterKey = loadMasterKey();
  }
  return cachedMasterKey;
}

function deriveKey(salt: Buffer): Buffer {
  return pbkdf2Sync(getMasterKey(), salt, ITERATIONS, KEY_LENGTH, "sha256");
}

/** Encrypt a plaintext string using AES-256-GCM with a PBKDF2-derived key. */
export function encrypt(plaintext: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: salt:iv:tag:ciphertext (all base64)
  return [salt, iv, tag, encrypted].map((b) => b.toString("base64")).join(":");
}

/** Decrypt an AES-256-GCM ciphertext string produced by {@link encrypt}. */
export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 4) throw new Error("Invalid encrypted format");

  const [salt, iv, tag, encrypted] = parts.map((p) => Buffer.from(p, "base64"));

  const key = deriveKey(salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// JWT helpers (HS256)
// ---------------------------------------------------------------------------

/** Fixed JWT header for all tokens produced by {@link signJwt}. */
const JWT_HEADER: string = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

/**
 * Claims that may appear in a JWT payload.
 * Additional application-defined claims can be included via the index signature.
 */
export interface JwtPayload {
  /** Expiration time (Unix seconds). */
  exp?: number;
  /** Issued-at time (Unix seconds). */
  iat?: number;
  /** Subject identifier. */
  sub?: string;
  /** Allows arbitrary additional claims. */
  [claim: string]: unknown;
}

/**
 * Sign a JWT payload with HMAC-SHA256 and return the compact token string.
 *
 * @param payload - Claims to encode. `iat` is set automatically when omitted.
 * @param secret - Shared secret used for signing.
 * @returns Compact JWT string (`header.payload.signature`).
 */
export function signJwt(payload: JwtPayload, secret: string): string {
  const claims: JwtPayload = { iat: Math.floor(Date.now() / 1000), ...payload };
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signingInput = `${JWT_HEADER}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * Validate a compact JWT string and return its decoded payload.
 *
 * @param token - Compact JWT string to validate.
 * @param secret - Shared secret used to verify the signature.
 * @returns The decoded payload if the token is valid.
 * @throws {Error} with `message` set to a descriptive reason when the token is
 *   invalid, expired, or malformed.
 */
export function validateJwt(token: string, secret: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("JWT malformed: expected three dot-separated parts");
  }

  const [encodedHeader, encodedPayload, signature] = parts;

  // Verify header
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as {
      alg?: string;
      typ?: string;
    };
  } catch {
    throw new Error("JWT malformed: header is not valid JSON");
  }
  if (header.alg !== "HS256") {
    throw new Error(`JWT unsupported algorithm: ${header.alg ?? "(none)"}`);
  }

  // Verify signature
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = createHmac("sha256", secret).update(signingInput).digest("base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  const actualBuf = Buffer.from(signature, "base64url");

  // Reject if lengths differ (timingSafeEqual requires equal-length buffers)
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new Error("JWT invalid: signature verification failed");
  }

  // Decode payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as JwtPayload;
  } catch {
    throw new Error("JWT malformed: payload is not valid JSON");
  }

  // Check expiration
  if (typeof payload.exp === "number" && Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error("JWT expired");
  }

  return payload;
}
