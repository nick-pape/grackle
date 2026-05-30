// Playwright globalSetup: clear any stale monocart coverage cache before a run
// so repeated local runs don't accumulate data. No-op unless E2E_COVERAGE=true.

import { CoverageReport } from "monocart-coverage-reports";

import { coverageOptions } from "./coverage-options.js";
import { COVERAGE_ENABLED } from "./coverage-helpers.js";

export default function globalSetup(): void {
  if (!COVERAGE_ENABLED) {
    return;
  }
  new CoverageReport(coverageOptions).cleanCache();
}
