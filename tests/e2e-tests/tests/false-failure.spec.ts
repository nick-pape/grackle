import { test, expect } from "./fixtures.js";
import { runStubTaskToCompletion } from "./helpers.js";

test.describe("False failure prevention", { tag: ["@error"] }, () => {
  test("task reaches paused status after stub session completes without false failure", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigateSimple("clean-task");

    await runStubTaskToCompletion(page);

    // Task should be in paused (review) — Complete button visible
    await expect(page.locator("button", { hasText: "Resume" })).toBeVisible({ timeout: 5_000 });

    // Task should NOT show failure indicators
    await expect(page.getByText("Task failed")).not.toBeVisible();
  });
});
