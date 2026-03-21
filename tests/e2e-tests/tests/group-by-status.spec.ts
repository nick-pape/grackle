import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  navigateToTask,
} from "./helpers.js";

/** Navigate to the Tasks sidebar tab so the TaskList with group-by-status toggle is visible. */
async function goToTasksTab(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-tasks"]').click();
}

test.describe("Group-by-status toggle", () => {
  // Clean up localStorage after each test to prevent state leakage
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("grackle-task-group-by-status"));
  });

  test("toggle switches to grouped view with status group headers", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "gbs-toggle");
    await createTask(page, "gbs-toggle", "task-a");
    await createTask(page, "gbs-toggle", "task-b");

    // Navigate to Tasks tab to access the group-by-status toggle
    await goToTasksTab(page);

    // Enable group-by-status
    await page.getByTestId("task-group-by-status-toggle").click();

    // Should see a status group header for not_started (both tasks default to that)
    const notStartedGroup = page.getByTestId("status-group-not_started");
    await expect(notStartedGroup).toBeVisible({ timeout: 5_000 });

    // Tasks should still be visible within the group
    await expect(page.getByText("task-a").first()).toBeVisible();
    await expect(page.getByText("task-b").first()).toBeVisible();
  });

  test("collapse and expand a status group", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "gbs-collapse");
    await createTask(page, "gbs-collapse", "collapse-task");

    await goToTasksTab(page);
    await page.getByTestId("task-group-by-status-toggle").click();

    const groupHeader = page.getByTestId("status-group-not_started");
    await expect(groupHeader).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("collapse-task").first()).toBeVisible();

    // Click the header to collapse
    await groupHeader.locator('[role="button"]').first().click();
    await expect(page.getByText("collapse-task").first()).not.toBeVisible({ timeout: 5_000 });

    // Click again to expand
    await groupHeader.locator('[role="button"]').first().click();
    await expect(page.getByText("collapse-task").first()).toBeVisible({ timeout: 5_000 });
  });

  test("toggle persists across page reload", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "gbs-persist");
    await createTask(page, "gbs-persist", "persist-task");

    await goToTasksTab(page);

    // Enable group-by-status
    await page.getByTestId("task-group-by-status-toggle").click();
    await expect(page.getByTestId("status-group-not_started").first()).toBeVisible({ timeout: 5_000 });

    // Verify localStorage was set (TaskList uses "grackle-task-group-by-status")
    const stored = await page.evaluate(() => localStorage.getItem("grackle-task-group-by-status"));
    expect(stored).toBe("true");

    // Reload and navigate back to Tasks tab
    await page.reload();
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
    await goToTasksTab(page);

    const toggle = page.getByTestId("task-group-by-status-toggle");
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    // Active toggle has "Switch to tree view" label; inactive has "Group tasks by status"
    await expect(toggle).toHaveAttribute("aria-label", "Switch to tree view");

    // localStorage should still hold the value after reload
    const storedAfter = await page.evaluate(() => localStorage.getItem("grackle-task-group-by-status"));
    expect(storedAfter).toBe("true");
  });

  test("empty status groups are hidden", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "gbs-empty");
    await createTask(page, "gbs-empty", "only-not-started");

    await goToTasksTab(page);
    await page.getByTestId("task-group-by-status-toggle").click();

    // Only not_started group should exist — empty groups should not be in the DOM at all
    await expect(page.getByTestId("status-group-not_started").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("status-group-working")).toHaveCount(0);
    await expect(page.getByTestId("status-group-paused")).toHaveCount(0);
    await expect(page.getByTestId("status-group-failed")).toHaveCount(0);
    await expect(page.getByTestId("status-group-complete")).toHaveCount(0);
  });

  test("toggle back restores tree view", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "gbs-restore");
    await createTask(page, "gbs-restore", "restore-parent");

    await goToTasksTab(page);

    // Enable grouped view
    await page.getByTestId("task-group-by-status-toggle").click();
    await expect(page.getByTestId("status-group-not_started").first()).toBeVisible({ timeout: 5_000 });

    // Disable grouped view — should return to tree
    await page.getByTestId("task-group-by-status-toggle").click();

    // Status groups should be gone
    await expect(page.getByTestId("status-group-not_started")).not.toBeVisible({ timeout: 5_000 });

    // Tree tasks should be visible again
    await expect(page.getByText("restore-parent").first()).toBeVisible();
  });

  test("task navigation from grouped view", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "gbs-nav");
    await createTask(page, "gbs-nav", "nav-target");

    await goToTasksTab(page);

    // Enable grouped view
    await page.getByTestId("task-group-by-status-toggle").click();
    await expect(page.getByTestId("status-group-not_started").first()).toBeVisible({ timeout: 5_000 });

    // Click the task in the grouped view
    await navigateToTask(page, "nav-target");

    // Task detail should load
    await expect(
      page.locator('[data-testid="task-title"]:has-text("nav-target")'),
    ).toBeVisible({ timeout: 5_000 });
  });
});
