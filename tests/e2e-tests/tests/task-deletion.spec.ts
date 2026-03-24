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

    // Create task
    await createTask(client, workspaceName, "doomed-task", "test-local");

    // Navigate to Tasks tab to see the task in the TaskList sidebar
    await goToTasksTab(page);

    // Verify the task is visible in the task list
    await expect(page.getByText("doomed-task").first()).toBeVisible({ timeout: 5_000 });

    // Get task ID and delete via RPC
    const workspaceId = await getWorkspaceId(client, workspaceName);
    const taskId = await getTaskId(client, workspaceId, "doomed-task");
    await client.deleteTask({ id: taskId });

    // Verify task disappears from the task list
    await expect(page.getByText("doomed-task")).not.toBeVisible({ timeout: 5_000 });
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
    await client.deleteTask({ id: taskId });

    // Navigate to Tasks tab and verify task disappeared
    await goToTasksTab(page);
    await expect(page.getByText("active-task")).not.toBeVisible({ timeout: 5_000 });
  });

  test("UI delete button shows confirm dialog and removes task on accept", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigateSimple("tdel-accept-task");

    await expect(page.locator("button", { hasText: "Delete" })).toBeVisible({ timeout: 5_000 });

    // Click Delete — the in-app ConfirmDialog should appear
    await page.locator("button", { hasText: "Delete" }).click();

    // Verify the dialog is visible with correct title and task name
    await expect(page.getByText("Delete Task?")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/"tdel-accept-task"/)).toBeVisible();

    // Confirm deletion via the dialog's danger button
    await page.locator('[role="dialog"] button', { hasText: "Delete" }).click();

    // Navigate to Tasks tab and verify task is gone
    await goToTasksTab(page);
    const sidebarTask = page.locator('[class*="taskTitle"]', { hasText: "tdel-accept-task" });
    await expect(sidebarTask).not.toBeVisible({ timeout: 5_000 });
  });

  test("UI delete confirm dialog can be dismissed to cancel deletion", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigateSimple("tdel-dismiss-task");

    // Click Delete — the in-app ConfirmDialog should appear
    await page.locator("button", { hasText: "Delete" }).click();

    // Verify the dialog is visible
    await expect(page.getByText("Delete Task?")).toBeVisible({ timeout: 5_000 });

    // Cancel via the Cancel button
    await page.locator('[role="dialog"] button', { hasText: "Cancel" }).click();

    // Dialog should be gone and task should still exist
    await expect(page.getByText("Delete Task?")).not.toBeVisible({ timeout: 5_000 });

    // Verify the task header is still showing (task was not deleted)
    await expect(page.locator('[data-testid="task-title"]')).toHaveText("tdel-dismiss-task", { timeout: 5_000 });

    // Also verify the task is still in the Tasks tab
    await goToTasksTab(page);
    const sidebarTask = page.locator('[class*="taskTitle"]', { hasText: "tdel-dismiss-task" });
    await expect(sidebarTask).toBeVisible({ timeout: 5_000 });
  });
});
