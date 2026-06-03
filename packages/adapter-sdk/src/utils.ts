import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
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

/** Maximum number of port-discovery attempts before giving up. */
const MAX_PORT_ATTEMPTS: number = 3;

/** Port-conflict error strings emitted by Docker, SSH, and Node. */
const PORT_CONFLICT_PATTERNS: string[] = ["address already in use", "port is already allocated"];

/**
 * Return true if an error indicates a port-binding conflict (EADDRINUSE or
 * equivalent messages from Docker / SSH / gh CLI).
 */
export function isPortConflictError(err: unknown): boolean {
  if (err instanceof Error) {
    if ("code" in err && (err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      return true;
    }
    const message = err.message.toLowerCase();
    return PORT_CONFLICT_PATTERNS.some((pattern) => message.includes(pattern));
  }
  return false;
}

/**
 * Discover a free port and pass it to `action`. If the action throws a
 * port-conflict error, retry with a freshly discovered port up to
 * `maxAttempts` times (default 3). When the caller already has a
 * preferred port, call the action directly instead of using this wrapper.
 */
export async function withFreePort<T>(
  action: (port: number) => Promise<T>,
  maxAttempts: number = MAX_PORT_ATTEMPTS,
): Promise<T> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(
      `withFreePort: maxAttempts must be a positive integer, got ${maxAttempts}`,
    );
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const port = await findFreePort();
    try {
      return await action(port);
    } catch (err) {
      if (attempt === maxAttempts || !isPortConflictError(err)) {
        throw err;
      }
    }
  }
  throw new Error("withFreePort: exhausted all attempts");
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
