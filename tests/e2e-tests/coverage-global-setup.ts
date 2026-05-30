// Playwright globalSetup: clear stale coverage state before a run so repeated
// local runs don't accumulate data. No-op unless E2E_COVERAGE=true.

import { rmSync, mkdirSync } from "node:fs";

import { CoverageReport } from "monocart-coverage-reports";

import { coverageOptions } from "./coverage-options.js";
import { BACKEND_V8_DIR } from "./coverage-options-backend.js";
import { COVERAGE_ENABLED } from "./coverage-helpers.js";

export default function globalSetup(): void {
  if (!COVERAGE_ENABLED) {
    return;
  }
  // Browser coverage: clear monocart's per-test cache.
  new CoverageReport(coverageOptions).cleanCache();
  // Backend coverage: reset the raw NODE_V8_COVERAGE dump dir the spawned
  // server/PowerLine processes write into.
  rmSync(BACKEND_V8_DIR, { recursive: true, force: true });
  mkdirSync(BACKEND_V8_DIR, { recursive: true });
}
