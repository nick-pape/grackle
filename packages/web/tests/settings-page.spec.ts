import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor } from "./helpers.js";

test.describe("Settings Page", () => {
  test("gear icon navigates to settings page", async ({ appPage }) => {
    const page = appPage;

    // Click the gear icon in the status bar
    await page.locator('button[title="Settings"]').click();

    // Settings page should be visible
    await expect(page.getByText("Settings")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("heading", { name: "Tokens" })).toBeVisible();
  });

  test("settings page renders token section", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Settings"]').click();
    await expect(page.getByText("Settings")).toBeVisible({ timeout: 5_000 });

    // Token section heading and description should render
    await expect(page.getByRole("heading", { name: "Tokens" })).toBeVisible();
    await expect(
      page.getByText("API tokens are auto-pushed to environments"),
    ).toBeVisible();
  });

  test("add token via settings form", async ({ appPage }) => {
    const page = appPage;

    // Navigate to settings
    await page.locator('button[title="Settings"]').click();
    await expect(page.getByText("Settings")).toBeVisible({ timeout: 5_000 });

    // Fill in the add token form
    await page.locator('input[placeholder="Token name"]').fill("ui-test-token");
    await page.locator('input[placeholder="Value"]').fill("secret123");
    await page.locator('input[placeholder*="Env var name"]').fill("UI_TEST_TOKEN");
    await page.locator("button", { hasText: "Add Token" }).click();

    // Token should appear in the list
    await expect(page.getByText("ui-test-token")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("UI_TEST_TOKEN")).toBeVisible();

    // Clean up via WS
    await sendWsAndWaitFor(
      page,
      { type: "delete_token", payload: { name: "ui-test-token" } },
      "token_changed",
    );
  });

  test("delete token via settings page", async ({ appPage }) => {
    const page = appPage;

    // First create a token via WS
    await sendWsAndWaitFor(
      page,
      {
        type: "set_token",
        payload: {
          name: "ui-delete-test",
          value: "to-delete",
          tokenType: "env_var",
          envVar: "DELETE_ME_UI",
          filePath: "",
        },
      },
      "token_changed",
    );

    // Navigate to settings
    await page.locator('button[title="Settings"]').click();
    await expect(page.getByText("Settings")).toBeVisible({ timeout: 5_000 });

    // Wait for token to appear
    await expect(page.getByText("ui-delete-test")).toBeVisible({ timeout: 5_000 });

    // Click delete button for this token
    const tokenRow = page.getByText("ui-delete-test").locator("..");
    await tokenRow.locator('button[title="Delete ui-delete-test"]').click();

    // Confirm via the in-app ConfirmDialog
    await expect(page.getByText("Delete Token?")).toBeVisible({ timeout: 5_000 });
    await page.locator('[role="dialog"] button', { hasText: "Delete" }).click();
    await expect(page.getByText("Delete Token?")).not.toBeVisible({ timeout: 5_000 });

    // Token should disappear
    await expect(page.getByText("ui-delete-test")).not.toBeVisible({ timeout: 5_000 });
  });

  test("add token with file type shows file path field", async ({ appPage }) => {
    const page = appPage;

    // Navigate to settings
    await page.locator('button[title="Settings"]').click();
    await expect(page.getByText("Settings")).toBeVisible({ timeout: 5_000 });

    // Select "File" type
    await page.locator("select").selectOption("file");

    // The placeholder should change to file path
    await expect(page.locator('input[placeholder*="File path"]')).toBeVisible();

    // Fill and submit
    await page.locator('input[placeholder="Token name"]').fill("file-ui-token");
    await page.locator('input[placeholder="Value"]').fill("filesecret");
    await page.locator('input[placeholder*="File path"]').fill("/tmp/.token");
    await page.locator("button", { hasText: "Add Token" }).click();

    // Verify token appears with file type badge
    await expect(page.getByText("file-ui-token")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("/tmp/.token")).toBeVisible();

    // Clean up
    await sendWsAndWaitFor(
      page,
      { type: "delete_token", payload: { name: "file-ui-token" } },
      "token_changed",
    );
  });

  test("token form clears after successful add", async ({ appPage }) => {
    const page = appPage;

    // Navigate to settings
    await page.locator('button[title="Settings"]').click();
    await expect(page.getByText("Settings")).toBeVisible({ timeout: 5_000 });

    // Fill in the form
    const nameInput = page.locator('input[placeholder="Token name"]');
    const valueInput = page.locator('input[placeholder="Value"]');
    await nameInput.fill("clear-test-token");
    await valueInput.fill("clearvalue");
    await page.locator("button", { hasText: "Add Token" }).click();

    // Wait for token to appear in list
    await expect(page.getByText("clear-test-token", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Form fields should be cleared
    await expect(nameInput).toHaveValue("");
    await expect(valueInput).toHaveValue("");

    // Clean up
    await sendWsAndWaitFor(
      page,
      { type: "delete_token", payload: { name: "clear-test-token" } },
      "token_changed",
    );
  });

  test("settings page description text is visible", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Settings"]').click();
    await expect(page.getByText("Settings")).toBeVisible({ timeout: 5_000 });

    // Description text should be visible
    await expect(
      page.getByText("API tokens are auto-pushed to environments when set or updated"),
    ).toBeVisible();
  });
});
