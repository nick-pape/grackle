import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("False failure prevention", () => {
  test("task reaches paused status after stub session completes without false failure", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "no-false-fail");
    await createTask(page, "no-false-fail", "clean-task", "test-local");
    await navigateToTask(page, "clean-task");

    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

    // Task should be in paused (review) — Complete button visible
    await expect(page.locator("button", { hasText: "Complete" })).toBeVisible({ timeout: 5_000 });

    // Task should NOT show failure indicators
    await expect(page.getByText("Task failed")).not.toBeVisible();
  });
});
