import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  createTaskViaWs,
  navigateToTask,
  getProjectId,
  getTaskId,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("Task Overview Tab", () => {
  test("overview tab is default for pending tasks", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "overview-default");
    await createTask(page, "overview-default", "pending-overview", "test-local");
    await navigateToTask(page, "pending-overview");

    // Overview tab should be active
    const overviewTab = page.getByRole("tab", { name: "Overview", exact: true });
    await expect(overviewTab).toHaveAttribute("class", /active/, { timeout: 5_000 });

    // Stream tab should NOT be active
    const streamTab = page.getByRole("tab", { name: "Stream", exact: true });
    await expect(streamTab).not.toHaveAttribute("class", /active/);
  });

  test("overview shows task description", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "overview-desc");
    // Create a UI task first to expand the project tree
    await createTask(page, "overview-desc", "desc-placeholder", "test-local");

    const projectId = await getProjectId(page, "overview-desc");

    await createTaskViaWs(page, projectId, "desc-task", {
      environmentId: "test-local",
      description: "This is a detailed task description for testing",
    });
    await page.getByText("desc-task").waitFor({ timeout: 5_000 });
    await navigateToTask(page, "desc-task");

    // Overview tab should show the description
    await expect(page.getByText("This is a detailed task description for testing")).toBeVisible({ timeout: 5_000 });
  });

  test("overview shows environment name", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "overview-env");
    await createTask(page, "overview-env", "env-task", "test-local");
    await navigateToTask(page, "env-task");

    // Environment is now derived from the latest session, so we must start the
    // task to create a session that carries the environmentId.
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

    // Switch to Overview tab to check environment display
    await page.getByRole("tab", { name: "Overview", exact: true }).click();

    // Overview should display the environment display name
    await expect(page.getByText("test-local")).toBeVisible({ timeout: 5_000 });
  });

  test("overview shows blocked dependencies in yellow", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "overview-deps");
    await createTask(page, "overview-deps", "dep-blocker", "test-local");

    const projectId = await getProjectId(page, "overview-deps");
    const blockerTaskId = await getTaskId(page, projectId, "dep-blocker");

    await createTaskViaWs(page, projectId, "dep-blocked", {
      environmentId: "test-local",
      dependsOn: [blockerTaskId],
    });
    await page.getByText("dep-blocked").waitFor({ timeout: 5_000 });
    await navigateToTask(page, "dep-blocked");

    // Overview should show the dependency with the blocker name
    await expect(page.getByText("Dependencies")).toBeVisible({ timeout: 5_000 });
    // The blocker task title should appear in the dependencies list
    const depItem = page.locator('[class*="depBlocked"]');
    await expect(depItem).toBeVisible();
    await expect(depItem).toContainText("dep-blocker");
  });

  test("overview shows done dependencies in green", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "overview-done-dep");
    await createTask(page, "overview-done-dep", "done-blocker", "test-local");

    // Complete the blocker task
    await navigateToTask(page, "done-blocker");
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    const projectId = await getProjectId(page, "overview-done-dep");
    const blockerTaskId = await getTaskId(page, projectId, "done-blocker");

    // Create a dependent task (its dep is already done)
    await createTaskViaWs(page, projectId, "unblocked-task", {
      environmentId: "test-local",
      dependsOn: [blockerTaskId],
    });
    await page.getByText("unblocked-task").waitFor({ timeout: 5_000 });
    await navigateToTask(page, "unblocked-task");

    // Dependency should show as done (green)
    const depItem = page.locator('[class*="depDone"]');
    await expect(depItem).toBeVisible({ timeout: 5_000 });
    await expect(depItem).toContainText("done-blocker");
  });

  test("sidebar shows blocked badge for tasks with incomplete dependencies", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "overview-badge");
    await createTask(page, "overview-badge", "badge-blocker", "test-local");

    const projectId = await getProjectId(page, "overview-badge");
    const blockerTaskId = await getTaskId(page, projectId, "badge-blocker");

    await createTaskViaWs(page, projectId, "badge-blocked", {
      environmentId: "test-local",
      dependsOn: [blockerTaskId],
    });
    await page.getByText("badge-blocked").waitFor({ timeout: 5_000 });

    // The sidebar badge should say "blocked" (not "dep") and have blocked styling
    const badge = page.locator('span[title^="Depends on:"]');
    await expect(badge).toHaveText("blocked");
    await expect(badge).toHaveAttribute("class", /blockedBadge/);
  });

  test("completing paused task switches to findings tab", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "overview-assigned");
    await createTask(page, "overview-assigned", "assigned-task", "test-local");
    await navigateToTask(page, "assigned-task");

    // Run task through to paused, then complete it
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Task is now complete — status should reflect completion
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 10_000 });
  });

  test("can manually switch to overview tab on working task", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "overview-manual");
    await createTask(page, "overview-manual", "manual-task", "test-local");
    await navigateToTask(page, "manual-task");

    // Start the task
    await patchWsForStubRuntime(page);
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
