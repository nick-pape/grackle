import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { API_KEY_FILENAME } from "@grackle/common";
import { logger } from "./logger.js";
import { grackleHome } from "./paths.js";

const API_KEY_BYTE_LENGTH = 32;

const keyPath = join(grackleHome, API_KEY_FILENAME);

let cachedKey: string | null = null;

/**
 * Load or generate the API key. On first run, a random 256-bit key is
 * generated and written to ~/.grackle/api-key with 0600 permissions.
 */
export function loadApiKey(): string {
  if (cachedKey) return cachedKey;

  if (existsSync(keyPath)) {
    cachedKey = readFileSync(keyPath, "utf8").trim();
    if (cachedKey.length > 0) return cachedKey;
  }

  // Generate a new key
  cachedKey = randomBytes(API_KEY_BYTE_LENGTH).toString("hex");

  mkdirSync(grackleHome, { recursive: true });
  writeFileSync(keyPath, cachedKey + "\n", { mode: 0o600 });

  // Ensure permissions on Windows (best-effort)
  try {
    chmodSync(keyPath, 0o600);
  } catch { /* Windows may not support this */ }

  logger.info({ keyPath }, "Generated new API key");
  return cachedKey;
}

/**
 * Verify a bearer token matches the API key.
 */
export function verifyApiKey(token: string): boolean {
  const key = loadApiKey();
  // Constant-time comparison to prevent timing attacks
  if (token.length !== key.length) return false;
  let result = 0;
  for (let i = 0; i < key.length; i++) {
    result |= token.charCodeAt(i) ^ key.charCodeAt(i);
  }
  return result === 0;
}
