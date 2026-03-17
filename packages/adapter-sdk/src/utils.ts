import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ─── Constants ──────────────────────────────────────────────

/** Remote directory where PowerLine artifacts are installed. Uses $HOME (not ~) so it expands inside double-quoted shell strings. */
export const REMOTE_POWERLINE_DIRECTORY: string = "$HOME/.grackle/powerline";

/** Timeout for the initial SSH connectivity test. */
export const SSH_CONNECTIVITY_TIMEOUT_MS: number = 15_000;

/** Default timeout for remote command execution. */
export const REMOTE_EXEC_DEFAULT_TIMEOUT_MS: number = 60_000;

// ─── Utilities ──────────────────────────────────────────────

/** Return a promise that resolves after the specified number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Find and return an available TCP port by briefly binding to port 0. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to get port")));
      }
    });
    server.on("error", reject);
  });
}

/**
 * Check if we are running from a monorepo source checkout.
 * We detect this by checking for `rush.json` at the repo root,
 * computed relative to this file's compiled location (packages/adapter-sdk/dist → 3 levels up).
 */
export function isDevMode(): boolean {
  const repoRoot = resolve(import.meta.dirname, "../../../");
  return existsSync(join(repoRoot, "rush.json"));
}

/**
 * Read the lockstep version from the SDK's own package.json.
 * import.meta.dirname = dist/, so ../package.json = adapter-sdk's package.json.
 */
export function getPackageVersion(): string {
  const packageJsonPath = resolve(import.meta.dirname, "../package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
  return pkg.version;
}

/**
 * Escape a value for safe use inside a shell single-quoted string.
 * Replaces each `'` with `'\''` (end quote, escaped quote, start quote).
 */
export function shellEscape(value: string): string {
  return value.replace(/'/g, "'\\''");
}
