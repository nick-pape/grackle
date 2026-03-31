import { test, expect } from "./fixtures.js";
import {
  createTask,
  navigateToTask,
  getWorkspaceId,
  getTaskId,
} from "./helpers.js";

/** Navigate to the Tasks sidebar tab so the TaskList is visible. */
async function goToTasksTab(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-tasks"]').click();
}

test.describe("Task Deletion", { tag: ["@task"] }, () => {
  test("delete pending task removes it from task list", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    // Create task and get its ID
    await createTask(client, workspaceName, "doomed-task", "test-local");
    const workspaceId = await getWorkspaceId(client, workspaceName);
    const taskId = await getTaskId(client, workspaceId, "doomed-task");

    // Navigate to Tasks tab to see the task in the TaskList sidebar
    await goToTasksTab(page);

    // Verify the task row is visible via its stable data-task-id attribute
    const taskRow = page.locator(`[data-task-id="${taskId}"]`);
    await expect(taskRow).toBeVisible({ timeout: 5_000 });

    // Delete via RPC
    await client.orchestration.deleteTask({ id: taskId });

    // Verify task row disappears from the task list
    await expect(taskRow).not.toBeVisible({ timeout: 5_000 });
  });

  test("delete in-progress task removes it and returns to workspace view", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    // Create task
    await createTask(client, workspaceName, "active-task", "test-local");

    // Navigate to the task and start it (stub runtime patched by fixture)
    await navigateToTask(page, "active-task");
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for active state (task may be working or paused depending on stub timing)
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, { timeout: 15_000 });

    // Delete the task via RPC while it's running
    const workspaceId = await getWorkspaceId(client, workspaceName);
    const taskId = await getTaskId(client, workspaceId, "active-task");
    await client.orchestration.deleteTask({ id: taskId });

    // Navigate to Tasks tab and verify task row disappeared
    await goToTasksTab(page);
    const taskRow = page.locator(`[data-task-id="${taskId}"]`);
    await expect(taskRow).not.toBeVisible({ timeout: 5_000 });
  });

  // ConfirmDialog UI tests (accept/dismiss) removed — covered by
  // ConfirmDialog.stories.tsx (ConfirmAction, DismissViaCancelButton).
});
