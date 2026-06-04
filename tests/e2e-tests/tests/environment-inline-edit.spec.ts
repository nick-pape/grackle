import { test, expect } from "./fixtures.js";
import { goToEnvironments } from "./helpers.js";

/**
 * Navigate to the environment detail page for the first environment.
 */
async function navigateToEnvDetailPage(page: import("@playwright/test").Page): Promise<void> {
  await goToEnvironments(page);
  await page.getByTestId("env-nav-item").first().click();
}

test.describe("Environment Detail Page — Inline Config Editing", { tag: ["@environment"] }, () => {
  test.beforeEach(async ({ appPage }) => {
    await navigateToEnvDetailPage(appPage);
  });

  test("configuration section is visible on detail page", async ({ appPage }) => {
    const page = appPage;
    await expect(page.getByTestId("env-config-section")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("env-edit-adapter-type")).toBeVisible();
  });

  test("environment name is inline-editable", async ({ appPage }) => {
    const page = appPage;
    const nameField = page.getByTestId("env-edit-name");
    await expect(nameField).toBeVisible({ timeout: 5_000 });
    await nameField.click();

    const input = page.getByRole("textbox", { name: "Environment name" });
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill("Renamed Env");
    await input.press("Enter");

    await expect(nameField).toContainText("Renamed Env", { timeout: 5_000 });
  });

  test("edit config button no longer exists", async ({ appPage }) => {
    const page = appPage;
    await expect(page.getByTestId("env-config-section")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("env-edit-btn")).toHaveCount(0);
  });
});
