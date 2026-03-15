import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  getProjectId,
  createTaskViaWs,
  navigateToTask,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("Group-by-status toggle", () => {
  test("toggle switches to grouped view with status group headers", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "gbs-toggle");
    await createTask(page, "gbs-toggle", "task-a");
    await createTask(page, "gbs-toggle", "task-b");

    // Enable group-by-status
    await page.getByTestId("group-by-status-toggle").click();

    // Should see a status group header for not_started (both tasks default to that)
    const notStartedGroup = page.getByTestId("status-group-not_started");
    await expect(notStartedGroup).toBeVisible({ timeout: 5_000 });

    // Tasks should still be visible within the group
    await expect(page.getByText("task-a").first()).toBeVisible();
    await expect(page.getByText("task-b").first()).toBeVisible();

    // Disable for next tests
    await page.getByTestId("group-by-status-toggle").click();
  });

  test("collapse and expand a status group", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "gbs-collapse");
    await createTask(page, "gbs-collapse", "collapse-task");

    await page.getByTestId("group-by-status-toggle").click();

    const groupHeader = page.getByTestId("status-group-not_started");
    await expect(groupHeader).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("collapse-task").first()).toBeVisible();

    // Click the header to collapse
    await groupHeader.locator('[role="button"]').first().click();
    await expect(page.getByText("collapse-task").first()).not.toBeVisible({ timeout: 5_000 });

    // Click again to expand
    await groupHeader.locator('[role="button"]').first().click();
    await expect(page.getByText("collapse-task").first()).toBeVisible({ timeout: 5_000 });

    // Disable for next tests
    await page.getByTestId("group-by-status-toggle").click();
  });

  test("toggle persists across page reload", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "gbs-persist");
    await createTask(page, "gbs-persist", "persist-task");

    // Enable group-by-status
    await page.getByTestId("group-by-status-toggle").click();
    await expect(page.getByTestId("status-group-not_started").first()).toBeVisible({ timeout: 5_000 });

    // Verify localStorage was set
    const stored = await page.evaluate(() => localStorage.getItem("grackle-group-by-status"));
    expect(stored).toBe("true");

    // Reload and verify the toggle is still in active state (green / aria-label says "Switch to tree view")
    await page.reload();
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    const toggle = page.getByTestId("group-by-status-toggle");
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    // Active toggle has "Switch to tree view" label; inactive has "Group tasks by status"
    await expect(toggle).toHaveAttribute("aria-label", "Switch to tree view");

    // localStorage should still hold the value after reload
    const storedAfter = await page.evaluate(() => localStorage.getItem("grackle-group-by-status"));
    expect(storedAfter).toBe("true");

    // Disable for next tests
    await page.getByTestId("group-by-status-toggle").click();
  });

  test("empty status groups are hidden", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "gbs-empty");
    await createTask(page, "gbs-empty", "only-not-started");

    await page.getByTestId("group-by-status-toggle").click();

    // Only not_started group should exist
    await expect(page.getByTestId("status-group-not_started").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("status-group-working")).not.toBeVisible();
    await expect(page.getByTestId("status-group-paused")).not.toBeVisible();
    await expect(page.getByTestId("status-group-failed")).not.toBeVisible();
    await expect(page.getByTestId("status-group-complete")).not.toBeVisible();

    // Disable for next tests
    await page.getByTestId("group-by-status-toggle").click();
  });

  test("toggle back restores tree view", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "gbs-restore");
    await createTask(page, "gbs-restore", "restore-parent");

    // Enable grouped view
    await page.getByTestId("group-by-status-toggle").click();
    await expect(page.getByTestId("status-group-not_started").first()).toBeVisible({ timeout: 5_000 });

    // Disable grouped view — should return to tree
    await page.getByTestId("group-by-status-toggle").click();

    // Status groups should be gone
    await expect(page.getByTestId("status-group-not_started")).not.toBeVisible({ timeout: 5_000 });

    // Tree tasks should be visible again
    await expect(page.getByText("restore-parent").first()).toBeVisible();
  });

  test("task navigation from grouped view", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "gbs-nav");
    await createTask(page, "gbs-nav", "nav-target");

    // Enable grouped view
    await page.getByTestId("group-by-status-toggle").click();
    await expect(page.getByTestId("status-group-not_started").first()).toBeVisible({ timeout: 5_000 });

    // Click the task in the grouped view
    await page.getByText("nav-target").first().click();

    // Task detail should load
    await expect(
      page.locator('[data-testid="task-title"]:has-text("nav-target")'),
    ).toBeVisible({ timeout: 5_000 });

    // Disable for next tests
    await page.getByTestId("group-by-status-toggle").click();
  });
});
