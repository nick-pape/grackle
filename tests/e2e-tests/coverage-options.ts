// Shared monocart-coverage-reports options for the E2E V8 coverage pass.
//
// The same options object MUST be used by every process that participates in a
// run (the per-test `add()` in worker processes and the `generate()` in global
// teardown) so they share the `<outputDir>/.cache` directory. See monocart's
// "Multiprocessing Support".
//
// Coverage is collected only when `E2E_COVERAGE=true`; see `coverage-helpers.ts`.

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CoverageReportOptions } from "monocart-coverage-reports";

/** Absolute path to the built web bundle that the E2E stack serves. */
const WEB_DIST_DIR: string = fileURLToPath(new URL("../../packages/web/dist/", import.meta.url));

/**
 * Resolve a source map from the local `packages/web/dist` on disk rather than
 * fetching it over HTTP. `generate()` runs in global teardown AFTER every
 * per-worker Grackle server has been torn down, so the served `*.js.map` URLs
 * are no longer reachable — but the dist files remain on disk. Without this,
 * V8 coverage would stay at the minified-bundle level and never map back to
 * `packages/web/src/**`.
 */
async function resolveSourceMapFromDist(
  url: string,
  defaultResolver: (u: string) => Promise<unknown>,
): Promise<unknown> {
  // `url` may be an absolute http(s) URL (served map) or a relative path; try
  // both the full pathname under dist and the basename under dist/assets.
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  pathname = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates: string[] = [
    join(WEB_DIST_DIR, pathname),
    join(WEB_DIST_DIR, "assets", basename(pathname)),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8"));
    } catch {
      // Try the next candidate.
    }
  }
  return defaultResolver(url);
}

/**
 * Keep only first-party web UI source unpacked from the bundle's source maps.
 * Vite emits sources relative to each package root, so the web app shows up as
 * `src/...` and the web-components package as `web-components/src/...`; bundled
 * dependencies show up under `node_modules/`, `common/`, `ahp/`, etc. Drop
 * everything but the two first-party `src` trees (and test/story/generated files
 * to mirror the Vitest `exclude` set).
 */
function isFirstPartyWebSource(sourcePath: string): boolean {
  const p: string = sourcePath.replace(/\\/g, "/");
  // Accept both the raw Vite form (`src/...`, `web-components/src/...`) and the
  // repo-relative form (`packages/web/src/...`) in case `sourcePath` rewriting
  // runs before this filter.
  const isWebApp: boolean = p.startsWith("src/") || p.includes("packages/web/src/");
  const isWebComponents: boolean =
    p.startsWith("web-components/src/") || p.includes("packages/web-components/src/");
  if (!isWebApp && !isWebComponents) {
    return false;
  }
  if (p.includes("/node_modules/") || p.includes("/gen/")) {
    return false;
  }
  return !/\.(test|stories)\.[cm]?[jt]sx?$/.test(p);
}

/**
 * Rewrite a first-party source path to a repo-root-relative key so the E2E lcov
 * unions cleanly with the per-package Vitest lcov in `@grackle-ai/coverage-merge`
 * (`src/App.tsx` → `packages/web/src/App.tsx`).
 */
function toRepoRelativePath(filePath: string): string {
  const p: string = filePath.replace(/\\/g, "/");
  if (p.startsWith("src/")) {
    return `packages/web/${p}`;
  }
  if (p.startsWith("web-components/src/")) {
    return `packages/${p}`;
  }
  return p;
}

/** Coverage report options shared across all processes of one E2E run. */
export const coverageOptions: CoverageReportOptions = {
  name: "Grackle E2E Coverage",
  outputDir: fileURLToPath(new URL("./coverage/", import.meta.url)),
  // `lcovonly` emits `coverage/lcov.info`, which the merge step consumes.
  reports: ["lcovonly", "console-summary"],
  logging: "info",
  sourceFilter: isFirstPartyWebSource,
  sourcePath: toRepoRelativePath,
  sourceMapResolver: resolveSourceMapFromDist,
};
