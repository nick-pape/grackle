import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  getProjectId,
  getTaskId,
  patchWsForStubRuntime,
  sendWsMessage,
} from "./helpers.js";

test.describe("Task Deletion", () => {
  test("delete pending task removes it from sidebar", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "del-remove");
    await createTask(page, "del-remove", "doomed-task", "test-local");

    // Verify the task is visible
    await expect(page.getByText("doomed-task")).toBeVisible();

    // Get task ID and delete via WS
    const projectId = await getProjectId(page, "del-remove");
    const taskId = await getTaskId(page, projectId, "doomed-task");
    await sendWsMessage(page, { type: "delete_task", payload: { taskId } });

    // Verify task disappears from sidebar
    await expect(page.getByText("doomed-task")).not.toBeVisible({ timeout: 5_000 });
  });

  test("delete in-progress task removes it and returns to project view", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "del-active");
    await createTask(page, "del-active", "active-task", "test-local");

    // Navigate to the task and start it
    await navigateToTask(page, "active-task");
    await patchWsForStubRuntime(page);
    await page.locator("button", { hasText: "Start Task" }).click();

    // Wait for in_progress state
    await expect(page.locator('[data-testid="task-status"]')).toContainText("in_progress", { timeout: 15_000 });

    // Delete the task via WS while it's running
    const projectId = await getProjectId(page, "del-active");
    const taskId = await getTaskId(page, projectId, "active-task");
    await sendWsMessage(page, { type: "delete_task", payload: { taskId } });

    // Verify task disappears from sidebar
    await expect(page.getByText("active-task")).not.toBeVisible({ timeout: 5_000 });
  });

  test("UI delete button shows confirm dialog and removes task on accept", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "tdel-confirm");
    await createTask(page, "tdel-confirm", "tdel-accept-task", "test-local");

    await navigateToTask(page, "tdel-accept-task");

    await expect(page.locator("button", { hasText: "Delete" })).toBeVisible({ timeout: 5_000 });

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("tdel-accept-task");
      await dialog.accept();
    });

    await page.locator("button", { hasText: "Delete" }).click();

    const sidebarTask = page.locator('[class*="taskTitle"]', { hasText: "tdel-accept-task" });
    await expect(sidebarTask).not.toBeVisible({ timeout: 5_000 });
  });

  test("UI delete confirm dialog can be dismissed to cancel deletion", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "tdel-dismiss");
    await createTask(page, "tdel-dismiss", "tdel-dismiss-task", "test-local");

    await navigateToTask(page, "tdel-dismiss-task");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("tdel-dismiss-task");
      await dialog.dismiss();
    });

    await page.locator("button", { hasText: "Delete" }).click();

    const sidebarTask = page.locator('[class*="taskTitle"]', { hasText: "tdel-dismiss-task" });
    await expect(sidebarTask).toBeVisible({ timeout: 5_000 });

    await expect(page.getByText("Task: tdel-dismiss-task")).toBeVisible({ timeout: 5_000 });
  });
});
