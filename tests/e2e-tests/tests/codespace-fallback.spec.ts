import { test as baseTest, expect } from "./fixtures.js";

/**
 * Custom fixture that intercepts the ConnectRPC ListCodespaces call
 * and returns an error response, simulating gh CLI failure.
 */
const test = baseTest.extend<{ codespaceErrorPage: import("@playwright/test").Page }>({
  codespaceErrorPage: async ({ page }, use) => {
    // Intercept the gRPC ListCodespaces call and return an error payload.
    // The WS bridge no longer handles list_codespaces — codespace listing
    // was migrated to ConnectRPC, so we intercept the HTTP route instead.
    await page.route("**/grackle.Grackle/ListCodespaces", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          codespaces: [],
          error: "Could not find the `gh` CLI. Ensure GitHub CLI is installed and available on your system PATH, then restart the Grackle server.",
        }),
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

test.describe("Codespace — manual entry fallback", { tag: ["@environment"] }, () => {
  test.beforeEach(async ({ codespaceErrorPage }) => {
    // Navigate to Environments tab → Add Environment
    await codespaceErrorPage.locator('[data-testid="sidebar-tab-environments"]').click();
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
