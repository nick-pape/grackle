import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("False failure prevention", () => {
  test("task reaches review status after stub session completes without false failure", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "no-false-fail");
    await createTask(page, "no-false-fail", "clean-task", "test-local");
    await navigateToTask(page, "clean-task");

    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

    // Task should be in review — Approve and Reject buttons visible
    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("button", { hasText: "Reject" })).toBeVisible();

    // Task should NOT show failure indicators
    await expect(page.getByText("Task failed")).not.toBeVisible();
  });
});
