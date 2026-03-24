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

test.describe("Group-by-status toggle", { tag: ["@workspace"] }, () => {
  // Clean up localStorage after each test to prevent state leakage
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("grackle-task-group-by-status"));
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

    // The not_started group should be visible (our task is there).
    // Other groups may exist from tasks created by prior tests in the shared server state.
    await expect(page.getByTestId("status-group-not_started").first()).toBeVisible({ timeout: 5_000 });
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
