import { defineConfig, devices } from "@playwright/test";

/**
 * Build a grep RegExp from the E2E_TAGS environment variable.
 * E2E_TAGS is a comma-separated list of Playwright @-tags (e.g., "@task,@session").
 * When unset or empty, returns undefined so all tests run.
 */
function buildTagGrep(): RegExp | undefined {
  const raw = process.env.E2E_TAGS?.trim();
  if (!raw) {
    return undefined;
  }
  const tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
  return tags.length > 0 ? new RegExp(tags.join("|")) : undefined;
}

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  grep: buildTagGrep(),
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
