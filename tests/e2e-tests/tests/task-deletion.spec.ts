import { test, expect } from "./fixtures.js";
import {
  createTask,
  navigateToTask,
  getWorkspaceId,
  getTaskId,
  sendWsMessage,
} from "./helpers.js";

/** Navigate to the Tasks sidebar tab so the TaskList is visible. */
async function goToTasksTab(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-tasks"]').click();
}

test.describe("Task Deletion", { tag: ["@task"] }, () => {
  test("delete pending task removes it from task list", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    // Create task
    await createTask(page, workspaceName, "doomed-task", "test-local");

    // Navigate to Tasks tab to see the task in the TaskList sidebar
    await goToTasksTab(page);

    // Verify the task is visible in the task list
    await expect(page.getByText("doomed-task").first()).toBeVisible({ timeout: 5_000 });

    // Get task ID and delete via WS
    const workspaceId = await getWorkspaceId(page, workspaceName);
    const taskId = await getTaskId(page, workspaceId, "doomed-task");
    await sendWsMessage(page, { type: "delete_task", payload: { taskId } });

    // Verify task disappears from the task list
    await expect(page.getByText("doomed-task")).not.toBeVisible({ timeout: 5_000 });
  });

  test("delete in-progress task removes it and returns to workspace view", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    // Create task
    await createTask(page, workspaceName, "active-task", "test-local");

    // Navigate to the task and start it (stub runtime patched by fixture)
    await navigateToTask(page, "active-task");
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for active state (task may be working or paused depending on stub timing)
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, { timeout: 15_000 });

    // Delete the task via WS while it's running
    const workspaceId = await getWorkspaceId(page, workspaceName);
    const taskId = await getTaskId(page, workspaceId, "active-task");
    await sendWsMessage(page, { type: "delete_task", payload: { taskId } });

    // Navigate to Tasks tab and verify task disappeared
    await goToTasksTab(page);
    await expect(page.getByText("active-task")).not.toBeVisible({ timeout: 5_000 });
  });

  // ConfirmDialog UI tests (accept/dismiss) removed — covered by
  // ConfirmDialog.stories.tsx (ConfirmAction, DismissViaCancelButton).
});
