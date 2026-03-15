import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { STATE_FILE } from "./state-file.js";

interface E2EState {
  grackleHome: string;
  apiKey: string;
  powerlinePid: number;
  serverPid: number;
  powerlinePort: number;
  serverPort: number;
  webPort: number;
}

function loadState(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

/**
 * Custom fixture that intercepts WebSocket traffic to replace
 * codespace list responses with an error, simulating gh CLI failure.
 */
const test = base.extend<{ codespaceErrorPage: import("@playwright/test").Page }>({
  baseURL: async ({}, use) => {
    const state = loadState();
    await use(`http://127.0.0.1:${state.webPort}`);
  },

  codespaceErrorPage: async ({ page, baseURL }, use) => {
    // Intercept WebSocket to inject codespace list errors
    await page.routeWebSocket(/.*/, (ws) => {
      const server = ws.connectToServer();

      ws.onMessage((message) => {
        server.send(message);
      });

      server.onMessage((message) => {
        if (typeof message === "string") {
          try {
            const parsed = JSON.parse(message);
            if (parsed.type === "codespaces_list") {
              // Replace successful list with an error
              ws.send(JSON.stringify({
                type: "codespaces_list",
                payload: {
                  codespaces: [],
                  error: "Could not find the `gh` CLI. Ensure GitHub CLI is installed and available on your system PATH, then restart the Grackle server.",
                },
              }));
              return;
            }
          } catch {
            // Not JSON, pass through
          }
        }
        ws.send(message);
      });
    });

    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
    await use(page);
  },
});

test.describe("Codespace — manual entry fallback", () => {
  test.beforeEach(async ({ codespaceErrorPage }) => {
    // Navigate to Settings → Add Environment
    await codespaceErrorPage.locator('button[title="Settings"]').click();
    await codespaceErrorPage.locator('button[title="Add environment"]').click();
    // Select the codespace adapter
    const adapterSelect = codespaceErrorPage.locator("select").first();
    await adapterSelect.selectOption("codespace");
  });

  test("shows manual entry input when codespace listing fails", async ({
    codespaceErrorPage: page,
  }) => {
    // Error hint should be visible
    await expect(
      page.locator('input[placeholder="Or enter codespace name manually..."]'),
    ).toBeVisible();

    // Error message text should be visible
    await expect(
      page.getByText("gh", { exact: false }),
    ).toBeVisible();
  });

  test("manual entry enables the Add button", async ({
    codespaceErrorPage: page,
  }) => {
    // Wait for the manual input to appear
    await expect(
      page.locator('input[placeholder="Or enter codespace name manually..."]'),
    ).toBeVisible();

    // Fill environment name
    await page
      .locator('input[placeholder="Environment name..."]')
      .fill("my-cs");

    // Fill manual codespace name
    await page
      .locator('input[placeholder="Or enter codespace name manually..."]')
      .fill("my-codespace-name");

    // Add button should be enabled
    const addButton = page.locator("button", { hasText: /^Add$/ });
    await expect(addButton).toBeEnabled();
  });
});
