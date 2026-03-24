import { test, expect } from "./fixtures.js";
import { runStubTaskToCompletion } from "./helpers.js";

test.describe("Complete and resume flow", { tag: ["@error"] }, () => {
  test("paused task can be completed", async ({ stubTask }) => {
    const { page } = stubTask;

    // --- Setup: Create task and navigate ---
    await stubTask.createAndNavigateSimple("complete task");

    // --- Run task to paused (review) state ---
    await runStubTaskToCompletion(page);

    // --- Stop the task (kill session + mark complete) ---
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    // --- Verify no failure ---
    await expect(page.getByText("Task failed")).not.toBeVisible();
  });
});
