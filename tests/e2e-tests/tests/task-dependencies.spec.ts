import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  createTaskViaWs,
  navigateToTask,
  getWorkspaceId,
  getTaskId,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

/** Navigate to the Tasks sidebar tab so the TaskList with dependency badges is visible. */
async function goToTasksTab(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-tasks"]').click();
}

test.describe("Task Dependencies", () => {
  test("blocked task shows Blocked by text and no Start button", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and a blocker task via UI
    await createWorkspace(page, "deps-blocked");
    await createTask(page, "deps-blocked", "blocker-alpha", "test-local");

    // Get IDs for creating dependent task via WS
    const workspaceId = await getWorkspaceId(page, "deps-blocked");
    const blockerTaskId = await getTaskId(page, workspaceId, "blocker-alpha");

    // Create a dependent task via WS with dependsOn
    await createTaskViaWs(page, workspaceId, "blocked-beta", {
      environmentId: "test-local",
      dependsOn: [blockerTaskId],
    });

    // Navigate to Tasks tab to see the task in the sidebar
    await goToTasksTab(page);

    // Wait for the dependent task to appear in the task list
    await page.getByText("blocked-beta", { exact: true }).first().waitFor({ timeout: 5_000 });

    // Verify the "blocked" indicator is visible in the sidebar (blocker is incomplete)
    await expect(page.locator('span[title^="Depends on:"]')).toHaveText("blocked");

    // Navigate to the blocked task
    await navigateToTask(page, "blocked-beta");

    // Verify "Blocked by:" text shows the blocker task name
    await expect(page.getByText("Blocked by: blocker-alpha")).toBeVisible({ timeout: 5_000 });

    // Verify "Start" button is NOT visible (blocked tasks show status instead)
    await expect(page.locator("button", { hasText: "Start" })).not.toBeVisible();
  });

  test("completing blocker unblocks dependent task", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and tasks
    await createWorkspace(page, "deps-unblock");
    await createTask(page, "deps-unblock", "unblock-blocker", "test-local");

    const workspaceId = await getWorkspaceId(page, "deps-unblock");
    const blockerTaskId = await getTaskId(page, workspaceId, "unblock-blocker");

    await createTaskViaWs(page, workspaceId, "unblock-dependent", {
      environmentId: "test-local",
      dependsOn: [blockerTaskId],
    });

    // Navigate to Tasks tab and wait for dependent task to appear
    await goToTasksTab(page);
    await page.getByText("unblock-dependent", { exact: true }).first().waitFor({ timeout: 5_000 });

    // Verify dependent is blocked
    await navigateToTask(page, "unblock-dependent");
    await expect(page.getByText("Blocked by:")).toBeVisible({ timeout: 5_000 });

    // Complete the blocker task: navigate, start with stub, send input, approve
    await patchWsForStubRuntime(page);
    await navigateToTask(page, "unblock-blocker");
    await runStubTaskToCompletion(page);
    await page.locator("button", { hasText: "Stop" }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    // Navigate back to dependent — should now be unblocked
    await navigateToTask(page, "unblock-dependent");
    await expect(page.locator("button", { hasText: "Start" })).toBeVisible({ timeout: 10_000 });
  });

  test("task with multiple dependencies requires all blockers complete", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and two blocker tasks
    await createWorkspace(page, "deps-multi");
    await createTask(page, "deps-multi", "multi-blocker-a", "test-local");
    await createTask(page, "deps-multi", "multi-blocker-b", "test-local");

    const workspaceId = await getWorkspaceId(page, "deps-multi");
    const taskAId = await getTaskId(page, workspaceId, "multi-blocker-a");
    const taskBId = await getTaskId(page, workspaceId, "multi-blocker-b");

    // Create task C dependent on both A and B
    await createTaskViaWs(page, workspaceId, "multi-dependent-c", {
      environmentId: "test-local",
      dependsOn: [taskAId, taskBId],
    });

    // Navigate to Tasks tab and wait for dependent task
    await goToTasksTab(page);
    await page.getByText("multi-dependent-c", { exact: true }).first().waitFor({ timeout: 5_000 });

    // Verify C is blocked by both
    await navigateToTask(page, "multi-dependent-c");
    await expect(page.getByText(/Blocked by:.*multi-blocker-a/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Blocked by:.*multi-blocker-b/)).toBeVisible();

    // Complete task A only
    await patchWsForStubRuntime(page);
    await navigateToTask(page, "multi-blocker-a");
    await runStubTaskToCompletion(page);
    await page.locator("button", { hasText: "Stop" }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    // C should still be blocked (only by B now)
    await navigateToTask(page, "multi-dependent-c");
    await expect(page.getByText(/Blocked by:.*multi-blocker-b/)).toBeVisible({ timeout: 5_000 });

    // Complete task B
    await navigateToTask(page, "multi-blocker-b");
    await runStubTaskToCompletion(page);
    await page.locator("button", { hasText: "Stop" }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    // C should now be unblocked
    await navigateToTask(page, "multi-dependent-c");
    await expect(page.locator("button", { hasText: "Start" })).toBeVisible({ timeout: 10_000 });
  });
});
