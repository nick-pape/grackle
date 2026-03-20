import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor, sendWsMessage, installWsTracker, injectWsMessage } from "./helpers.js";

test.describe("Sidebar — Tab Bar Navigation", () => {
  test("sidebar has tab bar with Chat, Tasks, Workspaces, and Settings tabs", async ({ appPage }) => {
    const page = appPage;

    const sidebar = page.locator('[data-testid="sidebar"]');

    // Tab bar should be visible
    await expect(sidebar.locator('[data-testid="sidebar-nav"]')).toBeVisible();

    // All four tabs should be present
    await expect(sidebar.locator('[data-testid="sidebar-tab-chat"]')).toBeVisible();
    await expect(sidebar.locator('[data-testid="sidebar-tab-tasks"]')).toBeVisible();
    await expect(sidebar.locator('[data-testid="sidebar-tab-workspaces"]')).toBeVisible();
    await expect(sidebar.locator('[data-testid="sidebar-tab-settings"]')).toBeVisible();
  });

  test("sidebar defaults to Chat tab", async ({ appPage }) => {
    const page = appPage;

    const sidebar = page.locator('[data-testid="sidebar"]');

    // Chat tab should be active by default (app redirects / to /chat)
    await expect(sidebar.locator('[data-testid="sidebar-tab-chat"]')).toHaveAttribute("aria-selected", "true");
  });

  test("clicking Workspaces tab shows workspace list", async ({ appPage }) => {
    const page = appPage;

    const sidebar = page.locator('[data-testid="sidebar"]');

    // Click the Workspaces tab
    await sidebar.locator('[data-testid="sidebar-tab-workspaces"]').click();

    // The "+" create workspace button should be visible
    await expect(sidebar.locator('button[title="Create workspace"]')).toBeVisible();
  });

  test("sidebar does NOT contain an Environments tab button", async ({ appPage }) => {
    const page = appPage;

    const sidebar = page.locator('[data-testid="sidebar"]');

    // Sidebar should NOT contain an "Environments" button
    await expect(sidebar.locator("button", { hasText: "Environments" })).not.toBeVisible();
  });
});

test.describe("Environments in Settings Panel", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.locator('[data-testid="sidebar-tab-settings"]').click();
    await expect(appPage.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
  });

  test("settings panel shows Environments tab", async ({ appPage }) => {
    const page = appPage;

    // Environments tab should be selected by default
    await expect(page.getByRole("tab", { name: "Environments" })).toHaveAttribute("aria-selected", "true");

    // Environment list header should be visible
    await expect(page.getByText("Environments").first()).toBeVisible();
  });

  test("settings panel shows environment list with test-local", async ({ appPage }) => {
    const page = appPage;

    // The seeded test-local environment should be listed
    await expect(page.getByText("test-local")).toBeVisible();
  });

  test("Environments tab is listed before Credentials tab", async ({ appPage }) => {
    const page = appPage;

    // Both tabs should be visible
    const envTab = page.getByRole("tab", { name: "Environments" });
    const credentialsTab = page.getByRole("tab", { name: "Credentials" });
    await expect(envTab).toBeVisible();
    await expect(credentialsTab).toBeVisible();

    // Environments tab should come before Credentials tab in the DOM
    const envY = (await envTab.boundingBox())!.y;
    const credentialsY = (await credentialsTab.boundingBox())!.y;
    expect(envY).toBeLessThan(credentialsY);
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

  test("clicking + Add Environment opens form and returns to Settings after submit", async ({ appPage }) => {
    const page = appPage;

    // Click + Add Environment
    await page.locator('button[title="Add environment"]').click();

    // Form should appear in UnifiedBar
    await expect(page.getByText("new env", { exact: true })).toBeVisible();
    await expect(page.locator('input[placeholder="Environment name..."]')).toBeVisible();

    // Fill name and submit
    await page.locator('input[placeholder="Environment name..."]').fill("settings-test-env");
    await page.locator("button", { hasText: "Add" }).click();

    // Should return to Settings panel (not empty mode)
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

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
    await page.getByText("test-local").click();

    // Action buttons should appear (Connect or Stop depending on state, and Delete)
    const deleteButton = page.locator("button", { hasText: "Delete" });
    await expect(deleteButton).toBeVisible({ timeout: 5_000 });
  });

  test("collapse environment row hides action buttons", async ({ appPage }) => {
    const page = appPage;

    // Click to expand
    await page.getByText("test-local").click();
    await expect(page.locator("button", { hasText: "Delete" })).toBeVisible({ timeout: 5_000 });

    // Click again to collapse
    await page.getByText("test-local").click();
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

    // Open Settings via sidebar tab
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

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

    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

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

    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

    await injectFakeSessions(page);

    // Expand sessions
    const summaryRow = page.locator('[data-testid="session-summary-row"]');
    await expect(summaryRow).toBeVisible({ timeout: 5_000 });
    await summaryRow.click();

    // Click the first session row
    const firstSession = page.locator('[data-testid="session-row"]').first();
    await expect(firstSession).toBeVisible({ timeout: 5_000 });
    await firstSession.click();

    // Settings panel should disappear (navigated to session view)
    await expect(page.getByRole("tablist", { name: "Settings" })).not.toBeVisible({ timeout: 5_000 });
  });

  test("environment with no sessions shows idle label, not summary row", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(() => document.body.innerText.includes("Connected"), { timeout: 10_000 });

    // Open Settings via sidebar tab
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

    // Inject empty sessions list to ensure test-local has zero sessions
    await injectWsMessage(page, { type: "sessions", payload: { sessions: [] } });

    // test-local should show (idle) when it has no sessions
    await expect(page.getByText("(idle)").first()).toBeVisible({ timeout: 5_000 });

    // No session summary row should exist
    await expect(page.locator('[data-testid="session-summary-row"]')).not.toBeVisible();
  });
});

test.describe("Navigation Between Settings and Workspaces", () => {
  test("clicking Grackle brand from Settings returns to home", async ({ appPage }) => {
    const page = appPage;

    // Navigate to Settings
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

    // Click Grackle brand to go home
    await page.locator('button[title="Home"]').click();

    // Should navigate to /chat (sidebar tab switches to Chat)
    await expect(page.locator('[data-testid="sidebar-tab-chat"]')).toHaveAttribute("aria-selected", "true", { timeout: 5_000 });
  });

  test("settings tab returns to Settings from workspace view", async ({ appPage }) => {
    const page = appPage;

    // Switch to Workspaces tab and create a workspace
    await page.locator('[data-testid="sidebar-tab-workspaces"]').click();
    const sidebar = page.locator('[data-testid="sidebar"]');
    await sidebar.locator('button[title="Create workspace"]').click();
    const nameInput = page.locator('input[placeholder="Workspace name..."]');
    await nameInput.fill("gear-test");
    await page.locator("button", { hasText: "OK" }).click();
    await expect(page.getByText("gear-test")).toBeVisible({ timeout: 5_000 });
    await page.getByText("gear-test").click();

    // Now click Settings tab
    await page.locator('[data-testid="sidebar-tab-settings"]').click();

    // Settings should be visible with Environments and Credentials tabs
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("tab", { name: "Environments" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Credentials" })).toBeVisible();
  });
});
