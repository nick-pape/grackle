import { test, expect } from "./fixtures.js";
import {
  clickSidebarWorkspace,
  createWorkspace,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("Complete and resume flow", () => {
  test("paused task can be completed", async ({ appPage }) => {
    const page = appPage;

    // --- Setup: Create workspace, task, navigate, patch runtime ---
    await createWorkspace(page, "complete-flow");
    await clickSidebarWorkspace(page, "complete-flow");
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
