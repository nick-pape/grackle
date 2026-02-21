import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { API_KEY_FILENAME } from "@grackle/common";
import { logger } from "./logger.js";
import { grackleHome } from "./paths.js";

const API_KEY_BYTE_LENGTH = 32;

const keyPath = join(grackleHome, API_KEY_FILENAME);

let cachedKey: string | null = null;

/** Attempt to read an existing API key from disk. Returns null if none exists. */
function tryLoadApiKey(): string | null {
  if (existsSync(keyPath)) {
    const content = readFileSync(keyPath, "utf8").trim();
    if (content.length > 0) {
      return content;
    }
  }
  return null;
}

/** Generate a new random API key, write it to disk with 0600 permissions, and return it. */
function createApiKey(): string {
  const key = randomBytes(API_KEY_BYTE_LENGTH).toString("hex");

  mkdirSync(grackleHome, { recursive: true });
  writeFileSync(keyPath, key + "\n", { mode: 0o600 });

  // Ensure permissions on Windows (best-effort)
  try {
    chmodSync(keyPath, 0o600);
  } catch { /* Windows may not support this */ }

  logger.info({ keyPath }, "Generated new API key");
  return key;
}

/**
 * Load or create the API key. On first run, a random 256-bit key is
 * generated and written to ~/.grackle/api-key with 0600 permissions.
 */
export function loadOrCreateApiKey(): string {
  if (cachedKey) {
    return cachedKey;
  }

  cachedKey = tryLoadApiKey() ?? createApiKey();
  return cachedKey;
}

/** Verify a bearer token matches the API key. */
export function verifyApiKey(token: string): boolean {
  const key = loadOrCreateApiKey();
  // Constant-time comparison to prevent timing attacks
  if (token.length !== key.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < key.length; i++) {
    result |= token.charCodeAt(i) ^ key.charCodeAt(i);
  }
  return result === 0;
}
