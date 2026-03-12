import { test, expect } from "./fixtures.js";
import { createProject, createTask, navigateToTask, patchWsForStubRuntime, runStubTaskToCompletion } from "./helpers.js";

test.describe("Auto-retry on rejection", () => {
  test("rejected task auto-retries with review notes and returns to review", async ({ appPage }) => {
    const page = appPage;

    // --- Setup: Create project, task, navigate, patch runtime ---
    await createProject(page, "auto-retry-proj");
    await page.getByText("auto-retry-proj").click();
    await createTask(page, "auto-retry-proj", "retry task", "test-local");
    await navigateToTask(page, "retry task");
    await patchWsForStubRuntime(page);

    // --- Run task to review ---
    await runStubTaskToCompletion(page);

    // --- Reject with review notes ---
    const rejectInput = page.locator('input[placeholder="Rejection notes (optional)..."]');
    await rejectInput.fill("add more tests");
    await page.locator("button", { hasText: "Reject" }).click();

    // --- Verify auto-retry starts — stub runtime reaches waiting_input again ---
    const retryInput = page.locator('input[placeholder="Type a message..."]');
    await expect(retryInput).toBeVisible({ timeout: 15_000 });
    await retryInput.fill("added tests");
    await page.locator("button", { hasText: "Send" }).click();

    // --- Verify task returns to review after retry ---
    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible({ timeout: 15_000 });

    // --- Verify no failure ---
    await expect(page.getByText("Task failed")).not.toBeVisible();

    // --- Approve to finish ---
    await page.locator("button", { hasText: "Approve" }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });
  });
});
