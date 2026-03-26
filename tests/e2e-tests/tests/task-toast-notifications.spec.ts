import { test, expect } from "./fixtures.js";
import {
  stubScenario,
  emitText,
  idle,
  navigateToTask,
} from "./helpers.js";

/**
 * Tests that task state changes trigger toast notifications in the web UI.
 *
 * Uses real task lifecycle operations (start, complete, update, delete) via the
 * gRPC API with the stub runtime to produce genuine domain events that flow
 * through the ConnectRPC StreamEvents transport.
 *
 * Toast messages are generic (no resource names) — see App.tsx comment.
 */

test.describe("Task State Toast Notifications", { tag: ["@task"] }, () => {
  test("task start shows started toast", async ({ stubTask }) => {
    const { page } = stubTask;

    // Create a task that goes idle after starting (keeps task in working state)
    await stubTask.createAndNavigate("toast-start", stubScenario(emitText("working"), idle()));

    // Start the task — transitions from not_started → working
    await page.getByTestId("task-header-start").click();

    // "Task is now running" toast should appear
    await expect(page.getByText("Task is now running")).toBeVisible({ timeout: 10_000 });
  });

  test("task completion shows completed toast", async ({ stubTask }) => {
    const { page, client } = stubTask;

    const task = await stubTask.createTask("toast-complete");
    await navigateToTask(page, "toast-complete");

    // Complete the task directly via RPC (not_started → complete)
    await client.completeTask({ id: task.id as string });

    // "Task complete" toast should appear
    await expect(page.getByText("Task complete", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("task failure shows failed toast", async ({ stubTask }) => {
    const { page, client } = stubTask;

    const task = await stubTask.createTask("toast-fail");
    await navigateToTask(page, "toast-fail");

    // Set task status to FAILED via UpdateTask (TASK_STATUS_FAILED = 6)
    await client.updateTask({
      id: task.id as string,
      title: "",
      description: "",
      status: 6,
      dependsOn: [],
    });

    // "Task failed to complete" toast should appear
    await expect(page.getByText("Task failed to complete")).toBeVisible({ timeout: 10_000 });
  });

  test("task removal shows deleted toast", async ({ stubTask }) => {
    const { page, client } = stubTask;

    const task = await stubTask.createTask("toast-delete");

    // Navigate to the task to ensure the client has processed the domain event
    await navigateToTask(page, "toast-delete");

    // Delete the task via RPC
    await client.deleteTask({ id: task.id as string });

    // "Task deleted" toast should appear
    await expect(page.getByText("Task deleted")).toBeVisible({ timeout: 5_000 });
  });
});
