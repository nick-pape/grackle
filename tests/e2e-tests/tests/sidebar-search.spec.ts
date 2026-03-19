import { test, expect } from "./fixtures.js";
import { createWorkspace, createTask, createTaskViaWs, getWorkspaceId } from "./helpers.js";

test.describe("Sidebar search filter", () => {
  // Clean up localStorage after each test to prevent state leakage
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("grackle-group-by-status"));
  });

  test("search input is visible when tasks exist", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "search-visible");
    await createTask(page, "search-visible", "search-vis-task", "test-local");

    const searchInput = page.getByTestId("sidebar-search");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await expect(searchInput).toHaveAttribute("aria-label", "Filter tasks");
  });

  test("typing filters tasks by title", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "filter-tasks");
    await createTask(page, "filter-tasks", "Fix login bug");
    await createTask(page, "filter-tasks", "Add dashboard");

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("login");

    // "Fix login bug" should be visible, "Add dashboard" should not
    await expect(page.getByText("Fix login bug").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Add dashboard")).not.toBeVisible({ timeout: 3_000 });
  });

  test("clearing filter restores full list", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "clear-filter-ws");
    await createTask(page, "clear-filter-ws", "Zebra Task", "test-local");
    await createTask(page, "clear-filter-ws", "Quantum Task", "test-local");

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("Zebra");

    // Only Zebra visible
    await expect(page.getByText("Quantum Task")).not.toBeVisible({ timeout: 3_000 });

    // Clear the filter
    await searchInput.fill("");

    // Both tasks should be visible again
    await expect(page.getByText("Zebra Task").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Quantum Task").first()).toBeVisible({ timeout: 5_000 });
  });

  test("search works in grouped-by-status view", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "grouped-search");
    await createTask(page, "grouped-search", "matching-task");
    await createTask(page, "grouped-search", "other-task");

    // Enable grouped view
    await page.getByTestId("group-by-status-toggle").click();
    await expect(page.getByTestId("status-group-not_started").first()).toBeVisible({ timeout: 5_000 });

    // Both tasks visible before filtering
    await expect(page.getByText("matching-task").first()).toBeVisible();
    await expect(page.getByText("other-task").first()).toBeVisible();

    // Filter
    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("matching");

    // Only matching task visible
    await expect(page.getByText("matching-task").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("other-task")).not.toBeVisible({ timeout: 3_000 });
  });

  test("matching text in task titles is highlighted", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "highlight-proj");
    await createTask(page, "highlight-proj", "Fix login bug");

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("login");

    // The task should be visible with "login" highlighted in a <mark> element
    // Use a combined locator to avoid race conditions from eager task loading
    const mark = page.locator('[data-task-id] mark');
    await expect(mark.first()).toBeVisible({ timeout: 10_000 });
    await expect(mark.first()).toHaveText("login");
  });

  test("search finds tasks created via WS", async ({ appPage }) => {
    const page = appPage;

    // Create a workspace and add a task via WS
    await createWorkspace(page, "ws-search-proj");
    const workspaceId = await getWorkspaceId(page, "ws-search-proj");
    await createTaskViaWs(page, workspaceId, "ws-created-needle");

    // Tasks are always visible in the flat sidebar — verify it's there
    await expect(page.getByText("ws-created-needle").first()).toBeVisible({ timeout: 5_000 });

    // Search should also find it
    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("ws-created-needle");

    await expect(page.getByText("ws-created-needle").first()).toBeVisible({ timeout: 10_000 });
  });
});
