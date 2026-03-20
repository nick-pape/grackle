import { test, expect } from "./fixtures.js";

test.describe("Environment Display", () => {
  test.beforeEach(async ({ appPage }) => {
    // Environments are now in Settings — navigate there via the gear button
    await appPage.locator('[data-testid="sidebar-tab-settings"]').click();
  });

  test("environment card renders with name", async ({ appPage }) => {
    await expect(appPage.locator("text=test-local")).toBeVisible();
  });

  test("status dot is accent-colored when connected", async ({ appPage }) => {
    // The environment list has a status dot span colored with --accent-green (purple in Grackle theme)
    const envSection = appPage.locator("text=test-local").locator("..");
    const dot = envSection.locator("span").first();
    await expect(dot).toHaveCSS("color", "rgb(139, 92, 246)"); // #8b5cf6
  });

  test("add environment + button is visible and enabled", async ({ appPage }) => {
    const plusButton = appPage.locator('button[title="Add environment"]');
    await expect(plusButton).toBeVisible();
    await expect(plusButton).toBeEnabled();
  });

  test("new chat + button is visible and enabled for connected environment", async ({ appPage }) => {
    const plusButton = appPage.locator('button[title="New chat"]');
    await expect(plusButton).toBeVisible();
    await expect(plusButton).toBeEnabled();
  });

  test("environment card is visible in list", async ({ appPage }) => {
    // Verify the environment entry renders (may show "(idle)" or session count)
    await expect(appPage.getByText("test-local")).toBeVisible();
  });
});
