import { defineConfig, devices } from "@playwright/test";
import { cpus } from "node:os";

/**
 * Build a grep RegExp from the E2E_TAGS environment variable.
 * E2E_TAGS is a comma-separated list of Playwright @-tags (e.g., "@task,@session").
 * When unset or empty, returns undefined so all tests run.
 */
function buildTagGrep(): RegExp | undefined {
  const raw = process.env.E2E_TAGS?.trim();
  if (!raw || raw === "all") {
    return undefined;
  }
  const tags = raw
    .split(",")
    .map((t) => t.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean);
  return tags.length > 0 ? new RegExp(tags.join("|")) : undefined;
}

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
  grep: buildTagGrep(),
  reporter: [
    ["list"],
    ["junit", { outputFile: "test-results/e2e-results.xml" }],
  ],
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
