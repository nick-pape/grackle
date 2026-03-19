import { test, expect } from "./fixtures.js";
import { createWorkspace, createTask, navigateToTask, patchWsForStubRuntime, runStubTaskToCompletion } from "./helpers.js";

test.describe("Session history", () => {
  test("single-session task hides attempt selector", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "single-sess");
    await createTask(page, "single-sess", "simple-task", "test-local");
    await navigateToTask(page, "simple-task");
    await patchWsForStubRuntime(page);

    await runStubTaskToCompletion(page);
    await page.locator("button", { hasText: "Stream" }).click();
    await expect(page.locator("[data-testid='attempt-selector']")).not.toBeVisible();
  });
});
