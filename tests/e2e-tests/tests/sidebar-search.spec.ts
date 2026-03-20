import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  createTaskViaWs,
  getSidebarWorkspaceLabel,
  getWorkspaceId,
} from "./helpers.js";

test.describe("Sidebar search filter", () => {
  // Clean up localStorage after each test to prevent state leakage
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("grackle-group-by-status"));
  });

  test("search input is visible when workspaces exist", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "search-visible");

    const searchInput = page.getByTestId("sidebar-search");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await expect(searchInput).toHaveAttribute("aria-label", "Filter workspaces and tasks");
  });

  test("typing filters workspaces by name", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "Alpha Project");
    await createWorkspace(page, "Beta Project");

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("Alpha");

    // Alpha should be visible, Beta should be hidden
    await expect(getSidebarWorkspaceLabel(page, "Alpha Project")).toBeVisible({ timeout: 5_000 });
    await expect(getSidebarWorkspaceLabel(page, "Beta Project")).not.toBeVisible({ timeout: 3_000 });
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

    await createWorkspace(page, "Zebra Corp");
    await createWorkspace(page, "Quantum Labs");

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("Zebra");

    // Only Zebra visible
    await expect(getSidebarWorkspaceLabel(page, "Quantum Labs")).not.toBeVisible({ timeout: 3_000 });

    // Clear the filter
    await searchInput.fill("");

    // Both workspaces should be visible again
    await expect(getSidebarWorkspaceLabel(page, "Zebra Corp")).toBeVisible({ timeout: 5_000 });
    await expect(getSidebarWorkspaceLabel(page, "Quantum Labs")).toBeVisible({ timeout: 5_000 });
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

  test("workspace match shows all its tasks", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "unique-proj-name");
    await createTask(page, "unique-proj-name", "task-aaa");
    await createTask(page, "unique-proj-name", "task-bbb");

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("unique-proj");

    // Workspace matches by name, so all tasks should be shown
    await expect(page.getByText("task-aaa").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("task-bbb").first()).toBeVisible({ timeout: 5_000 });
  });

  test("search finds tasks in unexpanded workspaces", async ({ appPage }) => {
    const page = appPage;

    // Create a workspace and add a task via WS (without expanding the workspace in the UI)
    await createWorkspace(page, "collapsed-proj");
    const workspaceId = await getWorkspaceId(page, "collapsed-proj");
    await createTaskViaWs(page, workspaceId, "hidden-needle");

    // The workspace is collapsed — "hidden-needle" should NOT be visible yet
    await expect(page.getByText("hidden-needle")).not.toBeVisible({ timeout: 2_000 });

    // Search for the task — should trigger eager load and find it
    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("hidden-needle");

    await expect(page.getByText("hidden-needle").first()).toBeVisible({ timeout: 10_000 });
  });
});
