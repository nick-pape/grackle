import { test, expect } from "./fixtures.js";

test.describe("Environment Display", () => {
  test.beforeEach(async ({ appPage }) => {
    // Stage2 sidebar defaults to "Projects" tab — switch to "Environments"
    await appPage.locator("button", { hasText: "Environments" }).click();
  });

  test("environment card renders with name", async ({ appPage }) => {
    await expect(appPage.locator("text=test-local")).toBeVisible();
  });

  test("status dot is green when connected", async ({ appPage }) => {
    // The environment list has a status dot span with #4ecca3 for connected
    const envSection = appPage.locator("text=test-local").locator("..");
    const dot = envSection.locator("span").first();
    await expect(dot).toHaveCSS("color", "rgb(78, 204, 163)"); // #4ecca3
  });

  test("+ button is visible and enabled", async ({ appPage }) => {
    const plusButton = appPage.locator("button", { hasText: "+" });
    await expect(plusButton).toBeVisible();
    await expect(plusButton).toBeEnabled();
  });

  test("(idle) shown when no sessions", async ({ appPage }) => {
    await expect(appPage.getByText("(idle)")).toBeVisible();
  });
});
