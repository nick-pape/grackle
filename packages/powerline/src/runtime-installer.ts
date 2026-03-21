import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { createRequire, register } from "node:module";
import { pathToFileURL } from "node:url";
import { RUNTIME_MANIFESTS } from "@grackle-ai/common";
import type { RuntimePackageManifest } from "@grackle-ai/common";
import { logger } from "./logger.js";

// ─── Constants ──────────────────────────────────────────────

/** Base directory for isolated per-runtime installs. */
const RUNTIMES_BASE_DIR: string = join(homedir(), ".grackle", "runtimes");

/** Filename for the version/staleness marker in each runtime directory. */
const MANIFEST_FILENAME: string = "manifest.json";

// ─── Types ──────────────────────────────────────────────────

/** Shape of the persisted manifest.json for staleness checking. */
interface PersistedManifest {
  /** PowerLine version that installed this runtime. */
  powerlineVersion: string;
  /** Snapshot of the package specs at install time. */
  packages: Record<string, string>;
}

/** Optional callbacks for install progress. */
export interface RuntimeInstallOptions {
  /** Callback for system-level events (e.g. "Installing claude-code runtime..."). */
  eventCallback?: (message: string) => void;
}

// ─── Dev Mode Detection ─────────────────────────────────────

/**
 * Check if PowerLine is running from a monorepo source checkout.
 * Looks for `rush.json` relative to PowerLine's compiled location
 * (packages/powerline/dist → 3 levels up).
 */
export function isDevMode(): boolean {
  const repoRoot = resolve(import.meta.dirname, "../../../");
  return existsSync(join(repoRoot, "rush.json"));
}

// ─── PowerLine Version ──────────────────────────────────────

/** Cached PowerLine version string, read once from package.json. */
let cachedVersion: string | undefined;

/** Read the PowerLine package version for manifest staleness checks. */
function getPowerLineVersion(): string {
  if (!cachedVersion) {
    try {
      const esmRequire = createRequire(import.meta.url);
      const pkg = esmRequire("../package.json") as { version: string };
      cachedVersion = pkg.version;
    } catch {
      cachedVersion = "unknown";
    }
  }
  return cachedVersion;
}

// ─── Single-Flight Guard ────────────────────────────────────

/** Prevents concurrent installs of the same runtime. */
const inflight: Map<string, Promise<string>> = new Map();

// ─── vscode-jsonrpc Hook ────────────────────────────────────

/** Whether the vscode-jsonrpc module resolve hook has been registered. */
let jsonRpcHookRegistered: boolean = false;

/**
 * Register a module resolve hook that rewrites `vscode-jsonrpc/node`
 * to `vscode-jsonrpc/node.js` for Node 22 strict ESM compatibility.
 * Only needed for the copilot runtime.
 */
function registerJsonRpcHook(): void {
  if (jsonRpcHookRegistered) {
    return;
  }
  register(
    "data:text/javascript," +
      encodeURIComponent(
        `export async function resolve(s,c,n){return s==="vscode-jsonrpc/node"?n("vscode-jsonrpc/node.js",c):n(s,c);}`,
      ),
  );
  jsonRpcHookRegistered = true;
}

// ─── Core API ───────────────────────────────────────────────

/**
 * Ensure that the npm packages for a runtime are installed in an isolated
 * directory under `~/.grackle/runtimes/<name>/`.
 *
 * **Fast path**: if the persisted manifest matches the current PowerLine
 * version and package specs, returns immediately (one `readFileSync`).
 *
 * **Dev mode**: returns empty string immediately — Rush already resolves
 * all packages via the monorepo's node_modules.
 *
 * @returns The absolute path to the runtime's install directory.
 */
export function ensureRuntimeInstalled(
  runtimeName: string,
  options: RuntimeInstallOptions = {},
): Promise<string> {
  // Dev mode: packages already available via Rush
  if (isDevMode()) {
    return Promise.resolve("");
  }

  if (!(runtimeName in RUNTIME_MANIFESTS)) {
    return Promise.reject(new Error(`Unknown runtime: ${runtimeName}. No manifest entry found.`));
  }
  const manifest = RUNTIME_MANIFESTS[runtimeName]!;

  const runtimeDir = join(RUNTIMES_BASE_DIR, runtimeName);

  // Fast path: check if already installed and up-to-date
  if (isManifestCurrent(runtimeDir, manifest)) {
    return Promise.resolve(runtimeDir);
  }

  // Single-flight: if another call is already installing this runtime, reuse its promise
  const existing = inflight.get(runtimeName);
  if (existing) {
    return existing;
  }

  const installPromise = doInstall(runtimeName, runtimeDir, manifest, options)
    .then(() => {
      inflight.delete(runtimeName);
      return runtimeDir;
    })
    .catch((err: unknown) => {
      inflight.delete(runtimeName);
      throw err;
    });

  inflight.set(runtimeName, installPromise);
  return installPromise;
}

/**
 * Dynamically import a module from an isolated runtime directory.
 *
 * In dev mode, falls back to standard `import()` since Rush handles resolution.
 *
 * @param runtimeName - Runtime identifier (e.g. "claude-code")
 * @param packageName - npm package name to import (e.g. "@anthropic-ai/claude-agent-sdk")
 * @returns The imported module
 */
export async function importFromRuntime<T>(runtimeName: string, packageName: string): Promise<T> {
  if (isDevMode()) {
    return import(packageName) as Promise<T>;
  }

  const runtimeDir = join(RUNTIMES_BASE_DIR, runtimeName);
  const require = createRequire(join(runtimeDir, "package.json"));
  const resolved = require.resolve(packageName);
  return import(pathToFileURL(resolved).href) as Promise<T>;
}

/**
 * Get the path to the `.bin` directory inside a runtime's node_modules.
 * Used to add runtime-specific CLI binaries to PATH when spawning agent subprocesses.
 *
 * @param runtimeName - Runtime identifier (e.g. "codex-acp")
 * @returns Absolute path to `~/.grackle/runtimes/<name>/node_modules/.bin`
 */
export function getRuntimeBinDirectory(runtimeName: string): string {
  if (isDevMode()) {
    // In dev mode, return the PowerLine package's own node_modules/.bin
    return resolve(import.meta.dirname, "../node_modules/.bin");
  }
  return join(RUNTIMES_BASE_DIR, runtimeName, "node_modules", ".bin");
}

// ─── Internal Helpers ───────────────────────────────────────

/** Check if the persisted manifest matches the current state. */
function isManifestCurrent(runtimeDir: string, manifest: RuntimePackageManifest): boolean {
  const manifestPath = join(runtimeDir, MANIFEST_FILENAME);
  try {
    const raw = readFileSync(manifestPath, "utf8");
    const persisted = JSON.parse(raw) as PersistedManifest;
    if (persisted.powerlineVersion !== getPowerLineVersion()) {
      return false;
    }
    // Compare package specs
    const currentKeys = Object.keys(manifest.packages).sort();
    const persistedKeys = Object.keys(persisted.packages).sort();
    if (currentKeys.length !== persistedKeys.length) {
      return false;
    }
    for (let i = 0; i < currentKeys.length; i++) {
      if (currentKeys[i] !== persistedKeys[i]) {
        return false;
      }
      if (manifest.packages[currentKeys[i]!] !== persisted.packages[currentKeys[i]!]) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Perform the actual npm install and write the manifest. */
async function doInstall(
  runtimeName: string,
  runtimeDir: string,
  manifest: RuntimePackageManifest,
  options: RuntimeInstallOptions,
): Promise<void> {
  const { eventCallback } = options;
  const packageNames = Object.entries(manifest.packages)
    .map(([name, version]) => `${name}@${version}`)
    .join(", ");

  logger.info({ runtimeName, packages: packageNames }, "Installing runtime packages");
  if (eventCallback) {
    eventCallback(`Installing ${runtimeName} runtime (${packageNames})...`);
  }

  // Ensure directory exists
  mkdirSync(runtimeDir, { recursive: true });

  // Write package.json
  const packageJson = {
    name: `grackle-runtime-${runtimeName}`,
    version: "1.0.0",
    private: true,
    dependencies: { ...manifest.packages },
  };
  writeFileSync(join(runtimeDir, "package.json"), JSON.stringify(packageJson, null, 2));

  // Run npm install
  try {
    execSync("npm install --omit=dev --registry=https://registry.npmjs.org", {
      cwd: runtimeDir,
      stdio: "pipe",
      timeout: 120_000,
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to install ${runtimeName} runtime packages. Run manually:\n`
      + `  cd ${runtimeDir} && npm install\n`
      + `Cause: ${detail}`,
    );
  }

  // Register vscode-jsonrpc hook if needed
  if (manifest.needsJsonRpcHook) {
    registerJsonRpcHook();
  }

  // Write manifest for staleness checking
  const persistedManifest: PersistedManifest = {
    powerlineVersion: getPowerLineVersion(),
    packages: { ...manifest.packages },
  };
  writeFileSync(join(runtimeDir, MANIFEST_FILENAME), JSON.stringify(persistedManifest, null, 2));

  logger.info({ runtimeName, runtimeDir }, "Runtime packages installed successfully");
  if (eventCallback) {
    eventCallback(`${runtimeName} runtime installed successfully`);
  }
}
