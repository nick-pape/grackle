import { test as base, type Page } from "@playwright/test";
import { startGrackleStack, stopGrackleStack, type E2EState } from "./server-manager.js";

interface WorkerFixtures {
  workerServer: E2EState;
}

interface TestFixtures {
  grackle: { apiKey: string; baseURL: string; wsUrl: string; mcpPort: number };
  appPage: Page;
}

/** Extended Playwright test fixture that spawns a per-worker Grackle stack. */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker-scoped: starts one Grackle stack per worker (4 ports + isolated DB).
  // Teardown kills processes and removes the temp directory when the worker exits.
  workerServer: [async ({}, use) => {
    const state = await startGrackleStack();
    await use(state);
    await stopGrackleStack(state);
  }, { scope: "worker" }],

  // Override Playwright's built-in baseURL so page.goto("/") resolves to the dynamic port
  baseURL: async ({ workerServer }, use) => {
    await use(`http://127.0.0.1:${workerServer.webPort}`);
  },

  // Inject the session cookie into every page context automatically
  page: async ({ page, baseURL, workerServer }, use) => {
    const eqIdx = workerServer.pairingCookie.indexOf("=");
    const cookieName = workerServer.pairingCookie.slice(0, eqIdx);
    const cookieValue = workerServer.pairingCookie.slice(eqIdx + 1);
    await page.context().addCookies([{
      name: cookieName,
      value: cookieValue,
      url: baseURL!,
    }]);
    await use(page);
  },

  grackle: async ({ baseURL, workerServer }, use) => {
    const wsUrl = `ws://127.0.0.1:${workerServer.webPort}`;
    await use({ apiKey: workerServer.apiKey, baseURL: baseURL!, wsUrl, mcpPort: workerServer.mcpPort });
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
