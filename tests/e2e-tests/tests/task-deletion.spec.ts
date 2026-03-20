import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  navigateToTask,
  getWorkspaceId,
  getTaskId,
  patchWsForStubRuntime,
  sendWsMessage,
} from "./helpers.js";

test.describe("Task Deletion", () => {
  test("delete pending task removes it from sidebar", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and task
    await createWorkspace(page, "del-remove");
    await createTask(page, "del-remove", "doomed-task", "test-local");

    // Verify the task is visible in sidebar
    await expect(page.getByText("doomed-task").first()).toBeVisible();

    // Get task ID and delete via WS
    const workspaceId = await getWorkspaceId(page, "del-remove");
    const taskId = await getTaskId(page, workspaceId, "doomed-task");
    await sendWsMessage(page, { type: "delete_task", payload: { taskId } });

    // Verify task disappears from sidebar
    await expect(page.getByText("doomed-task")).not.toBeVisible({ timeout: 5_000 });
  });

  test("delete in-progress task removes it and returns to workspace view", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and task
    await createWorkspace(page, "del-active");
    await createTask(page, "del-active", "active-task", "test-local");

    // Navigate to the task and start it
    await navigateToTask(page, "active-task");
    await patchWsForStubRuntime(page);
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for active state (task may be working or paused depending on stub timing)
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, { timeout: 15_000 });

    // Delete the task via WS while it's running
    const workspaceId = await getWorkspaceId(page, "del-active");
    const taskId = await getTaskId(page, workspaceId, "active-task");
    await sendWsMessage(page, { type: "delete_task", payload: { taskId } });

    // Verify task disappears from sidebar
    await expect(page.getByText("active-task")).not.toBeVisible({ timeout: 5_000 });
  });

  test("UI delete button shows confirm dialog and removes task on accept", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "tdel-confirm");
    await createTask(page, "tdel-confirm", "tdel-accept-task", "test-local");

    await navigateToTask(page, "tdel-accept-task");

    await expect(page.locator("button", { hasText: "Delete" })).toBeVisible({ timeout: 5_000 });

    // Click Delete — the in-app ConfirmDialog should appear
    await page.locator("button", { hasText: "Delete" }).click();

    // Verify the dialog is visible with correct title and task name
    await expect(page.getByText("Delete Task?")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/"tdel-accept-task"/)).toBeVisible();

    // Confirm deletion via the dialog's danger button
    await page.locator('[role="dialog"] button', { hasText: "Delete" }).click();

    const sidebarTask = page.locator('[class*="taskTitle"]', { hasText: "tdel-accept-task" });
    await expect(sidebarTask).not.toBeVisible({ timeout: 5_000 });
  });

  test("UI delete confirm dialog can be dismissed to cancel deletion", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "tdel-dismiss");
    await createTask(page, "tdel-dismiss", "tdel-dismiss-task", "test-local");

    await navigateToTask(page, "tdel-dismiss-task");

    // Click Delete — the in-app ConfirmDialog should appear
    await page.locator("button", { hasText: "Delete" }).click();

    // Verify the dialog is visible
    await expect(page.getByText("Delete Task?")).toBeVisible({ timeout: 5_000 });

    // Cancel via the Cancel button
    await page.locator('[role="dialog"] button', { hasText: "Cancel" }).click();

    // Dialog should be gone and task should still exist
    await expect(page.getByText("Delete Task?")).not.toBeVisible({ timeout: 5_000 });

    const sidebarTask = page.locator('[class*="taskTitle"]', { hasText: "tdel-dismiss-task" });
    await expect(sidebarTask).toBeVisible({ timeout: 5_000 });
    // Verify the task header is still showing (task was not deleted)
    await expect(page.locator('[data-testid="task-title"]')).toHaveText("tdel-dismiss-task", { timeout: 5_000 });
  });
});
