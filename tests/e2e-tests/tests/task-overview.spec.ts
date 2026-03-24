import { test, expect } from "./fixtures.js";
import {
  createTask,
  createTaskDirect,
  navigateToTask,
  getWorkspaceId,
  getTaskId,
  runStubTaskToCompletion,
} from "./helpers.js";

/** Navigate to the Tasks sidebar tab so the TaskList is visible. */
async function goToTasksTab(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-tasks"]').click();
}

test.describe("Task Overview Tab", { tag: ["@task"] }, () => {
  test("overview tab is default for pending tasks", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigateSimple("pending-overview");

    // Overview tab should be active
    const overviewTab = page.getByRole("tab", { name: "Overview", exact: true });
    await expect(overviewTab).toHaveAttribute("class", /active/, { timeout: 5_000 });

    // Stream tab should NOT be active
    const streamTab = page.getByRole("tab", { name: "Stream", exact: true });
    await expect(streamTab).not.toHaveAttribute("class", /active/);
  });

  test("overview shows task description", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    // Create a placeholder task first to expand the workspace tree
    await createTask(client, workspaceName, "desc-placeholder", "test-local");

    const workspaceId = await getWorkspaceId(client, workspaceName);

    await createTaskDirect(client, workspaceId, "desc-task", {
      environmentId: "test-local",
      description: "This is a detailed task description for testing",
    });

    // Navigate to Tasks tab and wait for the task to appear
    await goToTasksTab(page);
    await page.getByText("desc-task", { exact: true }).first().waitFor({ timeout: 5_000 });
    await navigateToTask(page, "desc-task");

    // Overview tab should show the description
    await expect(page.getByText("This is a detailed task description for testing")).toBeVisible({ timeout: 5_000 });
  });

  test("overview shows environment name", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigateSimple("env-task");

    // Environment is now derived from the latest session, so we must start the
    // task to create a session that carries the environmentId.
    await runStubTaskToCompletion(page);

    // Switch to Overview tab to check environment display
    await page.getByRole("tab", { name: "Overview", exact: true }).click();

    // Overview should display the environment display name
    await expect(page.getByTestId("task-overview-environment").getByText("test-local", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("overview shows blocked dependencies in yellow", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    await createTask(client, workspaceName, "dep-blocker", "test-local");

    const workspaceId = await getWorkspaceId(client, workspaceName);
    const blockerTaskId = await getTaskId(client, workspaceId, "dep-blocker");

    await createTaskDirect(client, workspaceId, "dep-blocked", {
      environmentId: "test-local",
      dependsOn: [blockerTaskId],
    });

    // Navigate to Tasks tab and wait for the task to appear
    await goToTasksTab(page);
    await page.getByText("dep-blocked", { exact: true }).first().waitFor({ timeout: 5_000 });
    await navigateToTask(page, "dep-blocked");

    // Overview should show the dependency with the blocker name
    await expect(page.getByText("Dependencies")).toBeVisible({ timeout: 5_000 });
    // The blocker task title should appear in the dependencies list
    const depItem = page.locator('[class*="depBlocked"]');
    await expect(depItem).toBeVisible();
    await expect(depItem).toContainText("dep-blocker");
  });

  test("overview shows done dependencies in green", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    await createTask(client, workspaceName, "done-blocker", "test-local");

    // Complete the blocker task
    await navigateToTask(page, "done-blocker");
    await runStubTaskToCompletion(page);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    const workspaceId = await getWorkspaceId(client, workspaceName);
    const blockerTaskId = await getTaskId(client, workspaceId, "done-blocker");

    // Create a dependent task (its dep is already done)
    await createTaskDirect(client, workspaceId, "unblocked-task", {
      environmentId: "test-local",
      dependsOn: [blockerTaskId],
    });

    // Navigate to Tasks tab and wait for the task to appear
    await goToTasksTab(page);
    await page.getByText("unblocked-task", { exact: true }).first().waitFor({ timeout: 5_000 });
    await navigateToTask(page, "unblocked-task");

    // Dependency should show as done (green)
    const depItem = page.locator('[class*="depDone"]');
    await expect(depItem).toBeVisible({ timeout: 5_000 });
    await expect(depItem).toContainText("done-blocker");
  });

  test("sidebar shows blocked badge for tasks with incomplete dependencies", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    await createTask(client, workspaceName, "badge-blocker", "test-local");

    const workspaceId = await getWorkspaceId(client, workspaceName);
    const blockerTaskId = await getTaskId(client, workspaceId, "badge-blocker");

    await createTaskDirect(client, workspaceId, "badge-blocked", {
      environmentId: "test-local",
      dependsOn: [blockerTaskId],
    });

    // Navigate to Tasks tab and wait for the task to appear
    await goToTasksTab(page);
    await page.getByText("badge-blocked", { exact: true }).first().waitFor({ timeout: 5_000 });

    // The sidebar badge should say "blocked" (not "dep") and have blocked styling
    const badge = page.locator('span[title^="Depends on:"]').first();
    await expect(badge).toHaveText("blocked");
    await expect(badge).toHaveAttribute("class", /blockedBadge/);
  });

  test("completing paused task switches to findings tab", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigateSimple("assigned-task");

    // Run task through to paused, then complete it
    await runStubTaskToCompletion(page);
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Task is now complete — status should reflect completion
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 10_000 });
  });

  test("can manually switch to overview tab on working task", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigateSimple("manual-task");

    // Start the task
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for working auto-switch to stream tab
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });

    // Manually click Overview tab
    await page.getByRole("tab", { name: "Overview", exact: true }).click();

    // Overview content should be visible
    const overviewTab = page.getByRole("tab", { name: "Overview", exact: true });
    await expect(overviewTab).toHaveAttribute("class", /active/);
  });
});
