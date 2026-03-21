import { test, expect } from "./fixtures.js";
import { createWorkspace, createTask } from "./helpers.js";

/**
 * Sidebar search filter tests for the TaskList sidebar on the Tasks tab.
 * The search input filters tasks by title using fuzzy matching.
 */

/** Navigate to the Tasks tab so the TaskList sidebar is visible. */
async function goToTasksTab(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-tasks"]').click();
}

test.describe("Sidebar search filter", { tag: ["@webui"] }, () => {
  test("search input is visible when tasks exist", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "search-vis");
    await createTask(page, "search-vis", "visible-task");

    await goToTasksTab(page);
    await expect(page.getByTestId("sidebar-search")).toBeVisible({ timeout: 5_000 });
  });

  test("typing filters tasks by title", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "search-filter");
    await createTask(page, "search-filter", "alpha-task");
    await createTask(page, "search-filter", "beta-task");

    await goToTasksTab(page);
    await expect(page.getByTestId("sidebar-search")).toBeVisible({ timeout: 5_000 });

    // Type a filter that matches only one task
    await page.getByTestId("sidebar-search").fill("alpha");

    // Only the matching task should be visible
    await expect(page.getByText("alpha-task", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("beta-task", { exact: true })).not.toBeVisible({ timeout: 3_000 });
  });

  test("clearing filter restores full list", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "search-clear");
    await createTask(page, "search-clear", "clear-alpha");
    await createTask(page, "search-clear", "clear-beta");

    await goToTasksTab(page);
    const searchInput = page.getByTestId("sidebar-search");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Filter to one task
    await searchInput.fill("clear-alpha");
    await expect(page.getByText("clear-beta", { exact: true })).not.toBeVisible({ timeout: 3_000 });

    // Clear the filter
    await searchInput.fill("");

    // Both tasks should be visible again
    await expect(page.getByText("clear-alpha", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("clear-beta", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
  });

  test("matching text in task titles is highlighted", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "search-highlight");
    await createTask(page, "search-highlight", "Fix login bug");

    await goToTasksTab(page);

    // Wait for the task to appear in the sidebar
    await page.getByTestId("sidebar").locator('[data-task-id]', { hasText: "Fix login bug" }).waitFor({ timeout: 15_000 });

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("login");

    // The task should be visible with "login" highlighted in a <mark> element
    const mark = page.locator('[data-task-id] mark');
    await expect(mark.first()).toBeVisible({ timeout: 15_000 });
    await expect(mark.first()).toHaveText("login");
  });
});
