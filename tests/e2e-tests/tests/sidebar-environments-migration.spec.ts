import { test, expect } from "./fixtures.js";

test.describe("App Navigation Bar", { tag: ["@environment"] }, () => {
  test("app nav bar has Chat, Tasks, and Settings tabs in Code context", async ({ appPage }) => {
    const page = appPage;

    // Code context tab bar should be visible
    await expect(page.locator('[data-testid="sidebar-nav"]')).toBeVisible();

    // Workbench tabs present in the Code tab bar
    await expect(page.locator('[data-testid="sidebar-tab-chat"]')).toBeVisible();
    await expect(page.locator('[data-testid="sidebar-tab-tasks"]')).toBeVisible();

    // Settings is in the context rail (gear icon), not the Code tab bar
    await expect(page.getByTestId("context-nav").getByTestId("context-nav-settings")).toBeVisible();

    // Environments is a fleet surface in the context rail
    await expect(
      page.getByTestId("context-nav").getByTestId("sidebar-tab-environments"),
    ).toBeVisible();
  });

  test("app defaults to Chat view in Code context", async ({ appPage }) => {
    const page = appPage;

    // The fixture lands at /chat (the default Code context view).
    await expect(page).toHaveURL(/\/chat/);
  });

  test("clicking Environments in fleet rail shows environment nav", async ({ appPage }) => {
    const page = appPage;

    // Click Environments in the fleet section of the context rail
    await page.getByTestId("context-nav").getByTestId("sidebar-tab-environments").click();

    // The environment nav and add button should be visible
    await expect(page.getByTestId("environment-nav")).toBeVisible();
    await expect(page.getByTestId("env-nav-add")).toBeVisible();
  });
});

test.describe("Environments Page", { tag: ["@environment"] }, () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.getByTestId("context-nav").getByTestId("sidebar-tab-environments").click();
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

  test("clicking + Add Environment opens form panel and returns to list after submit", async ({
    appPage,
    grackle: { client },
  }) => {
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
    await expect(page.getByText("settings-test-env", { exact: true })).toBeVisible({
      timeout: 5_000,
    });

    // Clean up
    const listResponse = await client.core.listEnvironments({});
    const envs = listResponse.environments as Array<{ id: string; displayName: string }>;
    const added = envs.find((e) => e.displayName === "settings-test-env");
    if (added) {
      await client.core.removeEnvironment({ id: added.id });
    }
  });
});

test.describe("Navigation Between Settings and Environments", { tag: ["@environment"] }, () => {
  test("clicking Grackle brand from Settings returns to Dashboard", async ({ appPage }) => {
    const page = appPage;

    // Navigate to Settings via gear icon in context rail
    await page.locator('[data-testid="context-nav-settings"]').click();
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

    // Click Grackle brand to go home — lands on / (Dashboard, fleet)
    await page.getByTestId("statusbar-brand").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 5_000 });
  });

  test("settings tab returns to Settings from environment view", async ({ appPage }) => {
    const page = appPage;

    // Switch to Environments in fleet rail and select an environment
    await page.getByTestId("context-nav").getByTestId("sidebar-tab-environments").click();
    await page.getByTestId("env-nav-item").first().click();

    // Click Settings gear icon in context rail (accessible from any context)
    await page.locator('[data-testid="context-nav-settings"]').click();

    // Settings should be visible with Credentials tab
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("tab", { name: "Credentials" })).toBeVisible();
  });
});
