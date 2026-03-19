import { test, expect } from "./fixtures.js";
import { createWorkspace, createTask, navigateToTask, patchWsForStubRuntime, runStubTaskToCompletion } from "./helpers.js";

test.describe("Task Stop & Pause buttons", () => {
  test("Stop button completes a paused task", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and task, run stub to paused (review) state
    await createWorkspace(page, "stop-task-proj");
    await createTask(page, "stop-task-proj", "stop task", "test-local");
    await navigateToTask(page, "stop task");
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

    // Task is now paused — Resume confirms paused state
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({ timeout: 5_000 });

    // Click Stop (should kill active sessions + mark task complete)
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Task status should become complete
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 10_000 });

    // Delete button should be visible (complete state actions)
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("paused state shows Stop and Resume buttons", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and task
    await createWorkspace(page, "pause-task-proj");
    await createTask(page, "pause-task-proj", "pause task", "test-local");
    await navigateToTask(page, "pause task");
    await patchWsForStubRuntime(page);

    // Start the task — the stub runtime transitions to idle quickly, which
    // causes the computed task status to become "paused". This verifies the
    // button layout in the paused state (Stop, Resume, Delete).
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for the task to reach paused state (Resume only appears in paused)
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({ timeout: 15_000 });

    // Stop and Delete buttons should also be visible
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("paused task can be resumed", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and task, run stub to paused (review) state
    await createWorkspace(page, "resume-task-proj");
    await createTask(page, "resume-task-proj", "resume task", "test-local");
    await navigateToTask(page, "resume task");
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

    // Task is paused — Resume button should be visible
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({ timeout: 5_000 });

    // Resume the task
    await page.getByRole("button", { name: "Resume", exact: true }).click();

    // Task should go back to working/paused — Stop button reappears
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({ timeout: 15_000 });
  });
});
