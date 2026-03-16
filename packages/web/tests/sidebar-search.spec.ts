import { test, expect } from "./fixtures.js";
import { createProject, createTask } from "./helpers.js";

test.describe("Sidebar search filter", () => {
  // Clean up localStorage after each test to prevent state leakage
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("grackle-group-by-status"));
  });

  test("search input is visible when projects exist", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "search-visible");

    const searchInput = page.getByTestId("sidebar-search");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await expect(searchInput).toHaveAttribute("aria-label", "Filter projects and tasks");
  });

  test("typing filters projects by name", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "Alpha Project");
    await createProject(page, "Beta Project");

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("Alpha");

    // Alpha should be visible, Beta should be hidden
    await expect(page.getByText("Alpha Project").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Beta Project")).not.toBeVisible({ timeout: 3_000 });
  });

  test("typing filters tasks by title", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "filter-tasks");
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

    await createProject(page, "Zebra Corp");
    await createProject(page, "Quantum Labs");

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("Zebra");

    // Only Zebra visible
    await expect(page.getByText("Quantum Labs")).not.toBeVisible({ timeout: 3_000 });

    // Clear the filter
    await searchInput.fill("");

    // Both projects should be visible again
    await expect(page.getByText("Zebra Corp").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Quantum Labs").first()).toBeVisible({ timeout: 5_000 });
  });

  test("search works in grouped-by-status view", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "grouped-search");
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

    await createProject(page, "highlight-proj");
    await createTask(page, "highlight-proj", "Fix login bug");

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("login");

    // The task should be visible with "login" highlighted in a <mark> element
    const taskRow = page.locator('[data-task-id]', { hasText: "Fix login bug" });
    await expect(taskRow).toBeVisible({ timeout: 5_000 });

    const mark = taskRow.locator("mark");
    await expect(mark).toBeVisible();
    await expect(mark).toHaveText("login");
  });

  test("project match shows all its tasks", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "unique-proj-name");
    await createTask(page, "unique-proj-name", "task-aaa");
    await createTask(page, "unique-proj-name", "task-bbb");

    const searchInput = page.getByTestId("sidebar-search");
    await searchInput.fill("unique-proj");

    // Project matches by name, so all tasks should be shown
    await expect(page.getByText("task-aaa").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("task-bbb").first()).toBeVisible({ timeout: 5_000 });
  });
});
