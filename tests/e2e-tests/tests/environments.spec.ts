import { test, expect } from "./fixtures.js";

function getEnvironmentRow(page: import("@playwright/test").Page, name: string) {
  return page.getByTestId("env-row").filter({ hasText: name }).first();
}

test.describe("Environment Display", () => {
  test.beforeEach(async ({ appPage }) => {
    // Navigate to the Environments tab
    await appPage.locator('[data-testid="sidebar-tab-environments"]').click();
  });

  test("environment card renders with name", async ({ appPage }) => {
    await expect(getEnvironmentRow(appPage, "test-local")).toBeVisible();
  });

  test("status dot is accent-colored when connected", async ({ appPage }) => {
    // The environment list has a status dot span colored with --accent-green (theme-dependent)
    const envSection = getEnvironmentRow(appPage, "test-local");
    const dot = envSection.locator("span").first();
    // Verify it's NOT the default gray text color (rgb(107, 114, 128)) — it should be accent-colored
    await expect(dot).not.toHaveCSS("color", "rgb(107, 114, 128)", { timeout: 5_000 });
  });

  test("add environment + button is visible and enabled", async ({ appPage }) => {
    const plusButton = appPage.locator('button[title="Add environment"]');
    await expect(plusButton).toBeVisible();
    await expect(plusButton).toBeEnabled();
  });

  test("new chat button is visible and enabled for connected environment", async ({ appPage }) => {
    // Navigate to the environment detail page to find the New Chat button
    await appPage.getByTestId("env-nav-item").first().click();
    const newChatButton = appPage.getByRole("button", { name: "New Chat" });
    await expect(newChatButton).toBeVisible({ timeout: 10_000 });
    await expect(newChatButton).toBeEnabled();
  });

  test("environment card is visible in list", async ({ appPage }) => {
    // Verify the environment entry renders (may show "(idle)" or session count)
    await expect(getEnvironmentRow(appPage, "test-local")).toBeVisible();
  });
});
