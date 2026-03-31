import { test, expect } from "./fixtures.js";
import { grackle } from "@grackle-ai/common";
import {
  stubScenario,
  emitText,
  idle,
  waitMs,
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

    // Create a task with a delay before idle to ensure the "working" state is
    // visible long enough for the client's task fetch to return it. Without
    // the delay, the stub runtime can reach idle before the first loadTasks
    // completes, causing the client to see not_started→paused and skip the
    // "Task is now running" toast entirely.
    await stubTask.createAndNavigate("toast-start", stubScenario(emitText("working"), waitMs(3000), idle()));

    // Start the task — transitions from not_started → working
    await page.getByTestId("task-header-start").click();

    // "Task is now running" toast should appear
    await expect(page.getByText("Task is now running")).toBeVisible({ timeout: 20_000 });
  });

  test("task completion shows completed toast", async ({ stubTask }) => {
    const { page, client } = stubTask;

    const task = await stubTask.createTask("toast-complete");
    await navigateToTask(page, "toast-complete");

    // Complete the task directly via RPC (not_started → complete)
    await client.orchestration.completeTask({ id: task.id as string });

    // "Task complete" toast should appear
    await expect(page.getByText("Task complete", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("task failure shows failed toast", async ({ stubTask }) => {
    const { page, client } = stubTask;

    const task = await stubTask.createTask("toast-fail");
    await navigateToTask(page, "toast-fail");

    // Set task status to FAILED via UpdateTask
    await client.orchestration.updateTask({
      id: task.id as string,
      title: "",
      description: "",
      status: grackle.TaskStatus.FAILED,
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
    await client.orchestration.deleteTask({ id: task.id as string });

    // "Task deleted" toast should appear
    await expect(page.getByText("Task deleted")).toBeVisible({ timeout: 5_000 });
  });
});
