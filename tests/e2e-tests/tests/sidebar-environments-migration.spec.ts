import { test, expect } from "./fixtures.js";
import {
  sendWsAndWaitFor,
  sendWsMessage,
} from "./helpers.js";

test.describe("App Navigation Bar", { tag: ["@environment"] }, () => {
  test("app nav bar has Chat, Tasks, Environments, and Settings tabs", async ({ appPage }) => {
    const page = appPage;

    // App nav bar should be visible (full-width, above sidebar)
    await expect(page.locator('[data-testid="sidebar-nav"]')).toBeVisible();

    // All four tabs should be present
    await expect(page.locator('[data-testid="sidebar-tab-chat"]')).toBeVisible();
    await expect(page.locator('[data-testid="sidebar-tab-tasks"]')).toBeVisible();
    await expect(page.locator('[data-testid="sidebar-tab-environments"]')).toBeVisible();
    await expect(page.locator('[data-testid="sidebar-tab-settings"]')).toBeVisible();
  });

  test("app defaults to home/dashboard view", async ({ appPage }) => {
    const page = appPage;

    // The home route renders the dashboard
    await expect(page).toHaveURL(/\/$/);
  });

  test("clicking Environments tab shows environment nav", async ({ appPage }) => {
    const page = appPage;

    // Click the Environments tab
    await page.locator('[data-testid="sidebar-tab-environments"]').click();

    // The environment nav and add button should be visible
    await expect(page.getByTestId("environment-nav")).toBeVisible();
    await expect(page.getByTestId("env-nav-add")).toBeVisible();
  });
});

test.describe("Environments Page", { tag: ["@environment"] }, () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.locator('[data-testid="sidebar-tab-environments"]').click();
  });

  test("environment nav shows test-local environment", async ({ appPage }) => {
    const page = appPage;

    // The seeded test-local environment should be listed in the nav
    await expect(page.getByTestId("env-nav-item")).toBeVisible();
  });

  test("+ Add Environment button is visible", async ({ appPage }) => {
    const page = appPage;

    await expect(page.getByTestId("env-nav-add")).toBeVisible();
    await expect(page.getByTestId("env-nav-add")).toHaveText("+ Add Environment");
  });

  test("clicking environment nav item shows detail page", async ({ appPage }) => {
    const page = appPage;

    // Click the environment
    await page.getByTestId("env-nav-item").first().click();

    // Detail page should show lifecycle actions
    await expect(page.getByTestId("env-edit-btn")).toBeVisible({ timeout: 5_000 });
  });

  test("clicking + Add Environment opens form panel and returns to list after submit", async ({ appPage }) => {
    const page = appPage;

    // Click + Add Environment
    await page.getByTestId("env-nav-add").click();

    // Form should appear in the main panel
    await expect(page.getByTestId("env-create-panel")).toBeVisible();
    await expect(page.getByTestId("env-create-name")).toBeVisible();

    // Fill name and submit
    await page.getByTestId("env-create-name").fill("settings-test-env");
    await page.getByTestId("env-create-submit").click();

    // Form should close
    await expect(page.getByTestId("env-create-panel")).not.toBeVisible({ timeout: 5_000 });

    // New environment should appear in the nav
    await expect(page.getByText("settings-test-env", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Clean up
    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_environments" },
      "environments",
    );
    const envs = (listResponse.payload?.environments || []) as Array<{ id: string; displayName: string }>;
    const added = envs.find((e) => e.displayName === "settings-test-env");
    if (added) {
      await sendWsMessage(page, {
        type: "remove_environment",
        payload: { environmentId: added.id },
      });
    }
  });
});

test.describe("Navigation Between Settings and Environments", { tag: ["@environment"] }, () => {
  test("clicking Grackle brand from Settings returns to home", async ({ appPage }) => {
    const page = appPage;

    // Navigate to Settings
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

    // Click Grackle brand to go home
    await page.locator('button[title="Home"]').click();

    // Should navigate to home (settings tab no longer active)
    await expect(page.locator('[data-testid="sidebar-tab-settings"]')).toHaveAttribute("aria-selected", "false", { timeout: 5_000 });
  });

  test("settings tab returns to Settings from environment view", async ({ appPage }) => {
    const page = appPage;

    // Switch to Environments tab and select an environment
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();

    // Now click Settings tab
    await page.locator('[data-testid="sidebar-tab-settings"]').click();

    // Settings should be visible with Credentials tab (Environments are in their own tab)
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("tab", { name: "Credentials" })).toBeVisible();
  });
});
