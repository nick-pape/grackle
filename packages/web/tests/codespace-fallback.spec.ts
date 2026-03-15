import { test, expect } from "./fixtures.js";
import { sendWsMessage } from "./helpers.js";

test.describe("Codespace — manual entry fallback", () => {
  test.beforeEach(async ({ appPage }) => {
    // Navigate to Settings → Add Environment
    await appPage.locator('button[title="Settings"]').click();
    await appPage.locator('button[title="Add environment"]').click();
    // Select the codespace adapter
    const adapterSelect = appPage.locator("select").first();
    await adapterSelect.selectOption("codespace");
  });

  test("shows manual entry input when codespace listing fails", async ({
    appPage,
  }) => {
    // Inject a codespace list error via WS
    await sendWsMessage(appPage, {
      type: "codespaces_list",
      payload: {
        codespaces: [],
        error:
          "Could not find the `gh` CLI. Ensure GitHub CLI is installed and available on your system PATH, then restart the Grackle server.",
      },
    });

    // Error message should be visible
    await expect(appPage.getByText("gh", { exact: false })).toBeVisible();
    // Manual input fallback should appear
    await expect(
      appPage.locator(
        'input[placeholder="Or enter codespace name manually..."]',
      ),
    ).toBeVisible();
  });

  test("manual entry enables the Add button", async ({
    appPage,
  }) => {
    // Inject a codespace list error
    await sendWsMessage(appPage, {
      type: "codespaces_list",
      payload: {
        codespaces: [],
        error: "gh not found",
      },
    });

    // Fill environment name
    await appPage
      .locator('input[placeholder="Environment name..."]')
      .fill("my-cs");

    // Fill manual codespace name
    await appPage
      .locator(
        'input[placeholder="Or enter codespace name manually..."]',
      )
      .fill("my-codespace-name");

    // Add button should be enabled
    const addButton = appPage.locator("button", { hasText: /^Add$/ });
    await expect(addButton).toBeEnabled();
  });
});
