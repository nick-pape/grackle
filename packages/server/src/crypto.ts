import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";
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
  cachedMasterKey ??= loadMasterKey();
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
