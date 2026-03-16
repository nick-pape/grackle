import { test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { STATE_FILE } from "./state-file.js";

interface E2EState {
  grackleHome: string;
  apiKey: string;
  pairingCookie: string;
  powerlinePid: number;
  serverPid: number;
  powerlinePort: number;
  serverPort: number;
  webPort: number;
}

function loadState(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

/** Extended Playwright test fixture that provides the Grackle API key and navigates to the app. */
export const test = base.extend<{ grackle: { apiKey: string; baseURL: string; wsUrl: string }; appPage: Page }>({
  // Override Playwright's built-in baseURL so page.goto("/") resolves to the dynamic port
  baseURL: async ({}, use) => {
    const state = loadState();
    await use(`http://127.0.0.1:${state.webPort}`);
  },

  // Inject the session cookie into every page context automatically
  page: async ({ page, baseURL }, use) => {
    const state = loadState();
    const eqIdx = state.pairingCookie.indexOf("=");
    const cookieName = state.pairingCookie.slice(0, eqIdx);
    const cookieValue = state.pairingCookie.slice(eqIdx + 1);
    await page.context().addCookies([{
      name: cookieName,
      value: cookieValue,
      url: baseURL!,
    }]);
    await use(page);
  },

  grackle: async ({ baseURL }, use) => {
    const state = loadState();
    const wsUrl = `ws://127.0.0.1:${state.webPort}`;
    await use({ apiKey: state.apiKey, baseURL: baseURL!, wsUrl });
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
