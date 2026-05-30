// Playwright globalTeardown: aggregate this shard's V8 coverage into lcov.
// Browser coverage -> coverage/lcov.info (web bundle); backend coverage ->
// coverage-backend/lcov.info (Node server + PowerLine, source-mapped to
// packages/<pkg>/src). Runs once per shard after all its specs complete.
// No-op unless E2E_COVERAGE=true.

import { existsSync, readdirSync } from "node:fs";

import { CoverageReport } from "monocart-coverage-reports";

import { coverageOptions } from "./coverage-options.js";
import { coverageOptionsBackend, BACKEND_V8_DIR } from "./coverage-options-backend.js";
import { COVERAGE_ENABLED } from "./coverage-helpers.js";

export default async function globalTeardown(): Promise<void> {
  if (!COVERAGE_ENABLED) {
    return;
  }
  // Browser report first (its outputDir `coverage/` is cleaned on generate);
  // the backend report writes to a sibling `coverage-backend/`, so order is safe.
  await new CoverageReport(coverageOptions).generate();

  // Backend report only if the spawned processes actually wrote V8 dumps.
  // On Windows the harness can't flush coverage (SIGTERM is a hard kill), so the
  // dir stays empty — skip rather than emit an empty/erroring report.
  if (existsSync(BACKEND_V8_DIR) && readdirSync(BACKEND_V8_DIR).length > 0) {
    await new CoverageReport(coverageOptionsBackend).generate();
  } else {
    process.stdout.write("[e2e-coverage] no backend V8 dumps — skipping backend report\n");
  }
}
