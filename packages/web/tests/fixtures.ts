import { test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const STATE_FILE = join(tmpdir(), "grackle-e2e-state.json");

interface E2EState {
  grackleHome: string;
  apiKey: string;
  sidecarPid: number;
  serverPid: number;
}

function loadState(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

/** Extended Playwright test fixture that provides the Grackle API key and navigates to the app. */
export const test = base.extend<{ grackle: { apiKey: string; baseURL: string }; appPage: Page }>({
  grackle: async ({}, use) => {
    const state = loadState();
    await use({ apiKey: state.apiKey, baseURL: "http://127.0.0.1:3000" });
  },

  appPage: async ({ page }, use) => {
    await page.goto("/");
    // Wait for the WebSocket to connect and initial data to load
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
    await use(page);
  },
});

export { expect } from "@playwright/test";
