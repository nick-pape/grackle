// Playwright globalTeardown: aggregate every worker's cached V8 coverage into
// `coverage/lcov.info` (source-mapped back to packages/web/src). Runs once per
// shard after all that shard's specs complete. No-op unless E2E_COVERAGE=true.

import { CoverageReport } from "monocart-coverage-reports";

import { coverageOptions } from "./coverage-options.js";
import { COVERAGE_ENABLED } from "./coverage-helpers.js";

export default async function globalTeardown(): Promise<void> {
  if (!COVERAGE_ENABLED) {
    return;
  }
  await new CoverageReport(coverageOptions).generate();
}
