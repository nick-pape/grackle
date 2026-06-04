import { defineConfig, devices } from "@playwright/test";
import { cpus } from "node:os";

/** Default parallel workers: override via E2E_WORKERS, else 2 in CI, else min(4, cpuCount/2). */
function getWorkerCount(): number | string {
  const envWorkers = process.env.E2E_WORKERS?.trim();
  if (envWorkers) {
    if (envWorkers.endsWith("%")) {
      return envWorkers;
    }
    const n = parseInt(envWorkers, 10);
    if (!isNaN(n) && n > 0) {
      return n;
    }
  }
  if (process.env.CI) {
    return 2;
  }
  return Math.max(1, Math.min(4, Math.floor(cpus().length / 2)));
}

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  // Coverage hooks are no-ops unless E2E_COVERAGE=true (see coverage-helpers.ts).
  // globalSetup clears stale monocart cache; globalTeardown aggregates each
  // worker's V8 coverage into coverage/lcov.info, source-mapped to web src.
  globalSetup: "./coverage-global-setup.ts",
  globalTeardown: "./coverage-global-teardown.ts",
  reporter: [["list"], ["junit", { outputFile: "test-results/e2e-results.xml" }]],
  use: {
    trace: process.env.CI ? "on-first-retry" : "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /knowledge\.spec\.ts/,
      workers: getWorkerCount(),
    },
    {
      name: "knowledge",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /knowledge\.spec\.ts/,
      // Run knowledge tests in a single serial worker to isolate Neo4j usage
      workers: 1,
    },
  ],
});
