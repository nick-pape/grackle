import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { API_KEY_FILENAME } from "@grackle-ai/common";
import { getAuthLogger } from "./auth-logger.js";

const API_KEY_BYTE_LENGTH: number = 32;

let cachedKey: string | undefined = undefined;

/** Attempt to read an existing API key from disk. Returns undefined if none exists. */
function tryLoadApiKey(keyPath: string): string | undefined {
  if (existsSync(keyPath)) {
    const content = readFileSync(keyPath, "utf8").trim();
    if (content.length > 0) {
      return content;
    }
  }
  return undefined;
}

/** Generate a new random API key, write it to disk with 0600 permissions, and return it. */
function createApiKey(homePath: string, keyPath: string): string {
  const key = randomBytes(API_KEY_BYTE_LENGTH).toString("hex");

  mkdirSync(homePath, { recursive: true });
  writeFileSync(keyPath, key + "\n", { mode: 0o600 });

  // Ensure permissions on Windows (best-effort)
  try {
    chmodSync(keyPath, 0o600);
  } catch { /* Windows may not support this */ }

  getAuthLogger().info({ keyPath }, "Generated new API key");
  return key;
}

/**
 * Load or create the API key. On first run, a random 256-bit key is
 * generated and written to `<homePath>/api-key` with 0600 permissions.
 *
 * @param homePath - The Grackle home directory (e.g., `~/.grackle`).
 */
export function loadOrCreateApiKey(homePath: string): string {
  if (cachedKey) {
    return cachedKey;
  }

  const keyPath = join(homePath, API_KEY_FILENAME);
  cachedKey = tryLoadApiKey(keyPath) ?? createApiKey(homePath, keyPath);
  return cachedKey;
}

/** Verify a bearer token matches the API key. */
export function verifyApiKey(token: string): boolean {
  if (!cachedKey) {
    return false;
  }
  // Constant-time comparison to prevent timing attacks
  if (token.length !== cachedKey.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < cachedKey.length; i++) {
    // eslint-disable-next-line no-bitwise
    result |= token.charCodeAt(i) ^ cachedKey.charCodeAt(i);
  }
  return result === 0;
}

/** Reset cached key (for testing). */
export function _resetCachedKeyForTesting(): void {
  cachedKey = undefined;
}
