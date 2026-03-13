import { test, expect } from "./fixtures.js";
import { createProject, createTask, navigateToTask, patchWsForStubRuntime, runStubTaskToCompletion } from "./helpers.js";

test.describe("Session history", () => {
  test("shows attempt selector after rejection and allows switching", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "sess-hist");
    await page.getByText("sess-hist").click();
    await createTask(page, "sess-hist", "hist-task", "test-local");
    await navigateToTask(page, "hist-task");
    await patchWsForStubRuntime(page);

    // Run task to review (first session)
    await runStubTaskToCompletion(page);

    // Switch to Stream tab — no attempt selector yet (single session)
    await page.locator("button", { hasText: "Stream" }).click();
    await expect(page.locator("[data-testid='attempt-selector']")).not.toBeVisible();

    // Reject → auto-retry creates second session
    const rejectInput = page.locator('input[placeholder="Rejection notes..."]');
    await rejectInput.fill("more tests");
    await page.locator("button", { hasText: "Reject" }).click();

    // Wait for retry to reach waiting_input
    await expect(page.locator('input[placeholder="Type a message..."]')).toBeVisible({ timeout: 10_000 });

    // Attempt selector should now appear with 2 buttons
    await expect(page.locator("[data-testid='attempt-selector']")).toBeVisible({ timeout: 3_000 });
    await expect(page.locator("[data-testid='attempt-1']")).toBeVisible();
    await expect(page.locator("[data-testid='attempt-2']")).toBeVisible();

    // Click attempt #1 → loads historical events
    await page.locator("[data-testid='attempt-1']").click();
    await page.waitForTimeout(500);

    // Click attempt #2 → back to current session
    await page.locator("[data-testid='attempt-2']").click();
    await page.waitForTimeout(300);

    // Complete retry
    await page.locator('input[placeholder="Type a message..."]').fill("done");
    await page.locator("button", { hasText: "Send" }).click();
    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible({ timeout: 10_000 });
  });

  test("single-session task hides attempt selector", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "single-sess");
    await page.getByText("single-sess").click();
    await createTask(page, "single-sess", "simple-task", "test-local");
    await navigateToTask(page, "simple-task");
    await patchWsForStubRuntime(page);

    await runStubTaskToCompletion(page);
    await page.locator("button", { hasText: "Stream" }).click();
    await expect(page.locator("[data-testid='attempt-selector']")).not.toBeVisible();
  });
});
