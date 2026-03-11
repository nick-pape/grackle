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
    await expect(page.getByText("in_progress")).toBeVisible({ timeout: 15_000 });

    // Delete the task via WS while it's running
    const projectId = await getProjectId(page, "del-active");
    const taskId = await getTaskId(page, projectId, "active-task");
    await sendWsMessage(page, { type: "delete_task", payload: { taskId } });

    // Verify task disappears from sidebar
    await expect(page.getByText("active-task")).not.toBeVisible({ timeout: 5_000 });
  });
});
