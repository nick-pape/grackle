// monocart-coverage-reports options for the BACKEND E2E V8 coverage pass.
//
// Browser coverage (coverage-options.ts) only sees the web bundle. The Grackle
// server + PowerLine run as separate Node processes; we instrument them with
// `NODE_V8_COVERAGE` (see server-manager.ts), which writes raw V8 dumps — with
// their source maps embedded as a `source-map-cache` — into BACKEND_V8_DIR.
// monocart reads that dir via `dataDir` and converts it to lcov, source-mapped
// back to `packages/<pkg>/src/**`.
//
// Collected only when `E2E_COVERAGE=true`; written once per shard in the
// Playwright globalTeardown.

import { fileURLToPath } from "node:url";

import type { CoverageReportOptions } from "monocart-coverage-reports";

/** The e2e-tests package root (this file's directory). */
const E2E_ROOT: string = fileURLToPath(new URL("./", import.meta.url));

/** Repo root, used as monocart's baseDir so emitted paths are repo-relative. */
const REPO_ROOT: string = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Directory the spawned server/PowerLine processes write raw `NODE_V8_COVERAGE`
 * dumps into. Lives OUTSIDE each worker's `GRACKLE_HOME` (which is `rmSync`'d at
 * teardown) and outside the browser report's `outputDir` (whose `clean` would
 * wipe it). Exported for reuse by server-manager + global setup.
 */
export const BACKEND_V8_DIR: string = fileURLToPath(new URL("./.v8-backend/", import.meta.url));

/** True if a path looks like first-party backend source we want to report on. */
function isBackendSource(sourcePath: string): boolean {
  const p: string = sourcePath.replace(/\\/g, "/");
  if (!/(^|\/)packages\/[^/]+\/src\//.test(p)) {
    return false;
  }
  if (p.includes("/node_modules/") || p.includes("/src/gen/") || p.includes("/vendor/")) {
    return false;
  }
  return !/\.(test|stories)\.[cm]?[jt]sx?$/.test(p);
}

/** Keep only V8 entries for our compiled backend dist (drop Node internals + deps early). */
function isBackendEntry(entry: { url: string }): boolean {
  const url: string = entry.url.replace(/\\/g, "/");
  return url.includes("/packages/") && url.includes("/dist/") && !url.includes("/node_modules/");
}

/** Coverage report options for the backend Node V8 pass. */
export const coverageOptionsBackend: CoverageReportOptions = {
  name: "Grackle Backend E2E Coverage",
  outputDir: fileURLToPath(new URL("./coverage-backend/", import.meta.url)),
  dataDir: BACKEND_V8_DIR,
  baseDir: REPO_ROOT,
  reports: ["lcovonly", "console-summary"],
  logging: "info",
  entryFilter: isBackendEntry,
  sourceFilter: isBackendSource,
};
