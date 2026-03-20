import { test as base, expect } from "./fixtures.js";
import { goToSettings } from "./helpers.js";

/**
 * Mock-mode settings page tests.
 *
 * These tests navigate to `/?mock` which uses MockGrackleProvider instead
 * of a real WebSocket connection. The mock provider is fully self-contained
 * in the browser — no server communication needed for state management.
 *
 * Uses the standard global-setup (which starts the Grackle server for
 * serving static files), but the `?mock` param bypasses all WebSocket
 * communication.
 */

const test = base.extend<{ mockPage: import("@playwright/test").Page }>({
  mockPage: async ({ page }, use) => {
    await page.goto("/?mock");
    // Mock mode always reports "Connected" immediately
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
    await use(page);
  },
});

test.describe("Settings Page (Mock Mode)", () => {
  test("gear icon is visible and navigates to settings", async ({ mockPage }) => {
    const page = mockPage;

    const settingsTab = page.locator('[data-testid="sidebar-tab-settings"]');
    await expect(settingsTab).toBeVisible({ timeout: 5_000 });

    await settingsTab.click();

    // Should redirect to environments tab
    await expect(page).toHaveURL(/\/settings\/environments/);
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
  });

  test("mock tokens are displayed in Credentials tab", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "Credentials" }).click();

    // MOCK_TOKENS has 3 tokens: anthropic, github, gcp-service-account
    await expect(page.getByText("anthropic", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("github", { exact: true })).toBeVisible();
    await expect(page.getByText("gcp-service-account")).toBeVisible();

    // Check targets are shown (scope to Tokens section to avoid matching provider descriptions)
    const tokensSection = page.getByRole("heading", { name: "Tokens" }).locator("..");
    await expect(tokensSection.getByText("ANTHROPIC_API_KEY")).toBeVisible();
    await expect(tokensSection.getByText("GITHUB_TOKEN")).toBeVisible();
    await expect(tokensSection.getByText("/home/user/.config/gcloud/credentials.json")).toBeVisible();
  });

  test("add token form is present and functional", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "Credentials" }).click();

    // Form elements should be visible
    await expect(page.locator('input[placeholder="Token name"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Value"]')).toBeVisible();
    await expect(page.locator("button", { hasText: "Add Token" })).toBeVisible();

    // Fill in and submit
    await page.locator('input[placeholder="Token name"]').fill("new-mock-token");
    await page.locator('input[placeholder="Value"]').fill("mock-value");
    await page.locator('input[placeholder*="Env var name"]').fill("NEW_MOCK_TOKEN");
    await page.locator("button", { hasText: "Add Token" }).click();

    // New token should appear in the list
    await expect(page.getByText("new-mock-token", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("NEW_MOCK_TOKEN")).toBeVisible();
  });

  test("delete token removes it from mock list", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "Credentials" }).click();

    // anthropic token should be visible
    await expect(page.getByText("anthropic", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Click delete on the anthropic token
    const tokenRow = page.getByText("anthropic", { exact: true }).locator("..");
    await tokenRow.locator('button[title="Delete anthropic"]').click();

    // Confirm via the in-app ConfirmDialog
    await expect(page.getByText("Delete Token?")).toBeVisible({ timeout: 5_000 });
    await page.locator('[role="dialog"] button', { hasText: "Delete" }).click();

    // Should be gone
    await expect(page.getByText("anthropic", { exact: true })).not.toBeVisible({ timeout: 5_000 });
  });

  test("type selector switches between env_var and file", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "Credentials" }).click();

    // Default type is env_var, placeholder should show env var
    await expect(page.locator('input[placeholder*="Env var name"]')).toBeVisible();

    // Switch to file type (use the token type select, not the provider dropdowns)
    await page.locator("select", { hasText: "Environment Variable" }).selectOption("file");

    // Placeholder should change to file path
    await expect(page.locator('input[placeholder*="File path"]')).toBeVisible();
  });

  test("description text is visible in Credentials tab", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "Credentials" }).click();

    await expect(
      page.getByText("API tokens are auto-pushed to environments when set or updated"),
    ).toBeVisible();
  });

  test("token form clears after add", async ({ mockPage }) => {
    const page = mockPage;

    await goToSettings(mockPage);
    await page.getByRole("tab", { name: "Credentials" }).click();

    const nameInput = page.locator('input[placeholder="Token name"]');
    const valueInput = page.locator('input[placeholder="Value"]');

    await nameInput.fill("clear-test");
    await valueInput.fill("clearval");
    await page.locator("button", { hasText: "Add Token" }).click();

    // Wait for token to appear
    await expect(page.getByText("clear-test", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Fields should be cleared
    await expect(nameInput).toHaveValue("");
    await expect(valueInput).toHaveValue("");
  });
});
