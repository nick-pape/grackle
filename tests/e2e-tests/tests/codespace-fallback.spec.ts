import { test as baseTest, expect } from "./fixtures.js";

/**
 * Custom fixture that intercepts WebSocket traffic to replace
 * codespace list responses with an error, simulating gh CLI failure.
 */
const test = baseTest.extend<{ codespaceErrorPage: import("@playwright/test").Page }>({
  codespaceErrorPage: async ({ page }, use) => {
    // Intercept WS before navigating so the first codespace list is replaced
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
    await codespaceErrorPage.locator('[data-testid="sidebar-tab-settings"]').click();
    await codespaceErrorPage.locator('button[title="Add environment"]').click();
    // Select the codespace adapter in the panel form
    await codespaceErrorPage.getByTestId("env-create-adapter").selectOption("codespace");
  });

  test("shows manual entry input when codespace listing fails", async ({
    codespaceErrorPage: page,
  }) => {
    // Manual input fallback should appear
    await expect(
      page.getByTestId("env-codespace-manual"),
    ).toBeVisible();

    // Error message text should be visible
    await expect(
      page.getByText("gh", { exact: false }),
    ).toBeVisible();

    // Select dropdown should be hidden when list error is present
    await expect(
      page.getByTestId("env-codespace-select"),
    ).not.toBeVisible();
  });

  test("manual entry enables the Create button", async ({
    codespaceErrorPage: page,
  }) => {
    // Wait for the manual input to appear
    await expect(
      page.getByTestId("env-codespace-manual"),
    ).toBeVisible();

    // Fill environment name
    await page.getByTestId("env-create-name").fill("my-cs");

    // Fill manual codespace name
    await page.getByTestId("env-codespace-manual").fill("my-codespace-name");

    // Create button should be enabled
    const createButton = page.getByTestId("env-create-submit");
    await expect(createButton).toBeEnabled();
  });
});
