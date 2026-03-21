import { test, expect } from "./fixtures.js";
import {
  clickSidebarWorkspace,
  sendWsAndWaitFor,
  sendWsMessage,
  installWsTracker,
  injectWsMessage,
} from "./helpers.js";

function getEnvironmentRow(page: import("@playwright/test").Page, name: string) {
  return page.getByTestId("env-row").filter({ hasText: name }).first();
}

test.describe("App Navigation Bar", () => {
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

  test("clicking Environments tab shows environment list", async ({ appPage }) => {
    const page = appPage;

    // Click the Environments tab
    await page.locator('[data-testid="sidebar-tab-environments"]').click();

    // The "+" add environment button should be visible
    const addButton = page.locator('button[title="Add environment"]');
    await expect(addButton).toBeVisible();
  });

  test("sidebar contains an Environments tab button", async ({ appPage }) => {
    const page = appPage;

    // Sidebar should contain an Environments tab
    await expect(page.locator('[data-testid="sidebar-tab-environments"]')).toBeVisible();
  });
});

test.describe("Environments Panel", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.locator('[data-testid="sidebar-tab-environments"]').click();
  });

  test("environments panel shows environment list with test-local", async ({ appPage }) => {
    const page = appPage;

    // The seeded test-local environment should be listed
    await expect(getEnvironmentRow(page, "test-local")).toBeVisible();
  });

  test("+ Add Environment button is visible and has correct text", async ({ appPage }) => {
    const page = appPage;

    const addButton = page.locator('button[title="Add environment"]');
    await expect(addButton).toBeVisible();
    await expect(addButton).toHaveText("+ Add Environment");
  });

  test("environment rows have data-testid", async ({ appPage }) => {
    const page = appPage;

    // At least the test-local environment should have the data-testid
    const envRows = page.locator('[data-testid="env-row"]');
    await expect(envRows.first()).toBeVisible();
  });

  test("clicking + Add Environment opens form panel and returns to list after submit", async ({ appPage }) => {
    const page = appPage;

    // Click + Add Environment
    await page.locator('button[title="Add environment"]').click();

    // Form should appear in the main panel (not UnifiedBar)
    await expect(page.getByTestId("env-create-panel")).toBeVisible();
    await expect(page.getByTestId("env-create-name")).toBeVisible();

    // Fill name and submit
    await page.getByTestId("env-create-name").fill("settings-test-env");
    await page.getByTestId("env-create-submit").click();

    // Form should close
    await expect(page.getByTestId("env-create-panel")).not.toBeVisible({ timeout: 5_000 });

    // New environment should appear in the list
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

  test("expand environment row shows action buttons", async ({ appPage }) => {
    const page = appPage;

    // Click on test-local to expand
    await getEnvironmentRow(page, "test-local").click();

    // Action buttons should appear (Connect or Stop depending on state, and Delete)
    const deleteButton = page.locator("button", { hasText: "Delete" });
    await expect(deleteButton).toBeVisible({ timeout: 5_000 });
  });

  test("collapse environment row hides action buttons", async ({ appPage }) => {
    const page = appPage;

    // Click to expand
    await getEnvironmentRow(page, "test-local").click();
    await expect(page.locator("button", { hasText: "Delete" })).toBeVisible({ timeout: 5_000 });

    // Click again to collapse
    await getEnvironmentRow(page, "test-local").click();
    await expect(page.locator("button", { hasText: "Delete" })).not.toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Session Accordion in Environment Card", () => {
  /** Inject fake sessions into the app via WS message. */
  async function injectFakeSessions(page: import("@playwright/test").Page): Promise<void> {
    await injectWsMessage(page, {
      type: "sessions",
      payload: {
        sessions: [
          { id: "s1", environmentId: "test-local", runtime: "stub", status: "running", prompt: "running session one", startedAt: "2025-01-01T00:00:00Z" },
          { id: "s2", environmentId: "test-local", runtime: "stub", status: "failed", prompt: "failed session two", startedAt: "2025-01-01T00:01:00Z" },
          { id: "s3", environmentId: "test-local", runtime: "stub", status: "completed", prompt: "completed session three", startedAt: "2025-01-01T00:02:00Z" },
        ],
      },
    });
  }

  test("session summary row visible when environment has sessions", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(() => document.body.innerText.includes("Connected"), { timeout: 10_000 });

    // Open Environments via sidebar tab
    await page.locator('[data-testid="sidebar-tab-environments"]').click();

    // Inject fake sessions for test-local
    await injectFakeSessions(page);

    // Summary row should appear with status counts
    const summaryRow = page.locator('[data-testid="session-summary-row"]');
    await expect(summaryRow).toBeVisible({ timeout: 5_000 });
    await expect(summaryRow).toContainText("1 running");
    await expect(summaryRow).toContainText("1 failed");
    await expect(summaryRow).toContainText("1 completed");

    // Count badge should show total
    await expect(summaryRow.locator("text=3")).toBeVisible();
  });

  test("session list hidden by default, expands on click", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(() => document.body.innerText.includes("Connected"), { timeout: 10_000 });

    await page.locator('[data-testid="sidebar-tab-environments"]').click();

    await injectFakeSessions(page);

    const summaryRow = page.locator('[data-testid="session-summary-row"]');
    await expect(summaryRow).toBeVisible({ timeout: 5_000 });

    // Session rows should NOT be visible when collapsed
    await expect(page.locator('[data-testid="session-row"]').first()).not.toBeVisible();

    // Click summary to expand
    await summaryRow.click();

    // Session rows should now be visible
    const sessionRows = page.locator('[data-testid="session-row"]');
    await expect(sessionRows).toHaveCount(3, { timeout: 5_000 });
    await expect(sessionRows.first()).toBeVisible();
  });

  test("clicking session row navigates to session view", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(() => document.body.innerText.includes("Connected"), { timeout: 10_000 });

    await page.locator('[data-testid="sidebar-tab-environments"]').click();

    await injectFakeSessions(page);

    // Expand sessions
    const summaryRow = page.locator('[data-testid="session-summary-row"]');
    await expect(summaryRow).toBeVisible({ timeout: 5_000 });
    await summaryRow.click();

    // Click the first session row
    const firstSession = page.locator('[data-testid="session-row"]').first();
    await expect(firstSession).toBeVisible({ timeout: 5_000 });
    await firstSession.click();

    // Environment panel should disappear (navigated to session view)
    await expect(page.locator('[data-testid="session-summary-row"]')).not.toBeVisible({ timeout: 5_000 });
  });

  test("environment with no sessions shows idle label, not summary row", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(() => document.body.innerText.includes("Connected"), { timeout: 10_000 });

    // Open Environments via sidebar tab
    await page.locator('[data-testid="sidebar-tab-environments"]').click();

    // Inject empty sessions list to ensure test-local has zero sessions
    await injectWsMessage(page, { type: "sessions", payload: { sessions: [] } });

    // test-local should show (idle) when it has no sessions
    await expect(page.getByText("(idle)").first()).toBeVisible({ timeout: 5_000 });

    // No session summary row should exist
    await expect(page.locator('[data-testid="session-summary-row"]')).not.toBeVisible();
  });
});

test.describe("Navigation Between Settings and Environments", () => {
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

  test("settings tab returns to Settings from workspace view", async ({ appPage }) => {
    const page = appPage;

    // Switch to Environments tab and create a workspace
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    const sidebar = page.locator('[data-testid="sidebar"]');
    await sidebar.locator('button[title="Create workspace"]').click();
    const nameInput = page.locator('input[placeholder="Workspace name..."]');
    await nameInput.fill("gear-test");
    await page.locator("button", { hasText: "OK" }).click();
    await expect(page.getByTestId("sidebar").getByText("gear-test", { exact: true })).toBeVisible({ timeout: 5_000 });
    await clickSidebarWorkspace(page, "gear-test");

    // Now click Settings tab
    await page.locator('[data-testid="sidebar-tab-settings"]').click();

    // Settings should be visible with Credentials tab (Environments are now in their own tab)
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("tab", { name: "Credentials" })).toBeVisible();
  });
});
