/**
 * Version status checker — queries the npm registry for the latest published
 * version of `@grackle-ai/cli` and compares against the running version.
 *
 * Results are cached for a configurable TTL (default 6 hours) to avoid
 * hammering the registry on every request.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { logger } from "./logger.js";

const require: NodeRequire = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a version status check. */
export interface VersionStatus {
  /** The currently running version. */
  currentVersion: string;
  /** The latest version available on npm. */
  latestVersion: string;
  /** Whether a newer version is available. */
  updateAvailable: boolean;
  /** Whether the server is running inside a Docker container. */
  isDocker: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** npm registry URL for fetching the latest version. */
const REGISTRY_URL: string = "https://registry.npmjs.org/@grackle-ai/cli/latest";

/** Default cache TTL: 6 hours. */
const DEFAULT_TTL_MS: number = 6 * 60 * 60 * 1000;

/** Fetch timeout to avoid blocking startup. */
const FETCH_TIMEOUT_MS: number = 5_000;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cachedResult: VersionStatus | undefined;
let cachedAt: number = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check the npm registry for the latest version.
 *
 * Returns a cached result if within `ttlMs`. On any error (network, parse,
 * timeout), returns a safe default with `updateAvailable: false`.
 *
 * @param ttlMs - Cache time-to-live in milliseconds. Defaults to 6 hours.
 */
export async function checkVersionStatus(ttlMs: number = DEFAULT_TTL_MS): Promise<VersionStatus> {
  // Return cached if fresh
  if (cachedResult && Date.now() - cachedAt < ttlMs) {
    return cachedResult;
  }

  const currentVersion = getCurrentVersion();
  const isDocker = existsSync("/.dockerenv");

  const controller = new AbortController();
  const timeout: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(REGISTRY_URL, { signal: controller.signal });

    if (!response.ok) {
      logger.debug({ status: response.status }, "npm registry returned non-OK status");
      return cacheAndReturn({ currentVersion, latestVersion: currentVersion, updateAvailable: false, isDocker });
    }

    const data = await response.json() as Record<string, unknown>;
    const latestVersion = typeof data.version === "string" ? data.version : "";

    if (!latestVersion) {
      logger.debug("npm registry response missing version field");
      return cacheAndReturn({ currentVersion, latestVersion: currentVersion, updateAvailable: false, isDocker });
    }

    const updateAvailable = latestVersion !== currentVersion;
    return cacheAndReturn({ currentVersion, latestVersion, updateAvailable, isDocker });
  } catch (error) {
    logger.debug({ err: error }, "Failed to check npm registry for updates");
    return cacheAndReturn({ currentVersion, latestVersion: currentVersion, updateAvailable: false, isDocker });
  } finally {
    clearTimeout(timeout);
  }
}

/** Clear the cached version check result. Exported for testing. */
export function clearVersionCache(): void {
  cachedResult = undefined;
  cachedAt = 0;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Cache a result and return it. */
function cacheAndReturn(result: VersionStatus): VersionStatus {
  cachedResult = result;
  cachedAt = Date.now();
  return result;
}

/** Read the current version from the CLI package.json. */
function getCurrentVersion(): string {
  try {
    const pkg = require("@grackle-ai/cli/package.json") as { version: string };
    return pkg.version;
  } catch {
    // Fallback: if CLI isn't resolvable, read our own package.json
    try {
      const corePkg = require("../package.json") as { version: string };
      return corePkg.version;
    } catch {
      return "0.0.0";
    }
  }
}
