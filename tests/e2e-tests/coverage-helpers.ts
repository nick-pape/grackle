// Per-test V8 coverage collection helpers, used by the `page` fixture.
//
// Collection is opt-in via `E2E_COVERAGE=true` so local TDD runs stay fast and
// the Chromium-only `page.coverage` API is never touched when disabled. Any
// failure here is logged and swallowed — coverage must never fail a test.

import { CoverageReport } from "monocart-coverage-reports";
import type { Page } from "@playwright/test";

import { coverageOptions } from "./coverage-options.js";

/** Whether E2E coverage collection is enabled for this run. */
export const COVERAGE_ENABLED: boolean = process.env.E2E_COVERAGE === "true";

/** Begin V8 JS coverage on a fresh page (before it navigates). No-op when disabled. */
export async function startCoverage(page: Page): Promise<void> {
  if (!COVERAGE_ENABLED) {
    return;
  }
  // `resetOnNavigation: false` keeps coverage across the `appPage` goto("/").
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
}

/** Stop coverage and append it to the shared monocart cache. No-op when disabled. */
export async function collectCoverage(page: Page): Promise<void> {
  if (!COVERAGE_ENABLED) {
    return;
  }
  try {
    const coverage = await page.coverage.stopJSCoverage();
    const report: CoverageReport = new CoverageReport(coverageOptions);
    await report.add(coverage);
  } catch (err: unknown) {
    process.stderr.write(`[e2e-coverage] failed to collect coverage: ${String(err)}\n`);
  }
}
