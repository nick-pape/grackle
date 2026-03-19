import { test, expect } from "./fixtures.js";
import { createProject, createTask, navigateToTask, patchWsForStubRuntime, runStubTaskToCompletion } from "./helpers.js";

test.describe("Complete and resume flow", () => {
  test("paused task can be completed", async ({ appPage }) => {
    const page = appPage;

    // --- Setup: Create project, task, navigate, patch runtime ---
    await createProject(page, "complete-flow");
    await page.getByText("complete-flow").click();
    await createTask(page, "complete-flow", "complete task", "test-local");
    await navigateToTask(page, "complete task");
    await patchWsForStubRuntime(page);

    // --- Run task to paused (review) state ---
    await runStubTaskToCompletion(page);

    // --- Stop the task (kill session + mark complete) ---
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    // --- Verify no failure ---
    await expect(page.getByText("Task failed")).not.toBeVisible();
  });
});
