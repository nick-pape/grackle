import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
} from "./helpers.js";

test.describe("Task Retry (failed → in_progress)", () => {
  test("retry button restarts a failed task", async ({ appPage }) => {
    const page = appPage;

    // --- Setup: create project and task ---
    await createProject(page, "retry-proj");
    await page.getByText("retry-proj").click();
    await createTask(page, "retry-proj", "retry task", "test-local");
    await navigateToTask(page, "retry task");
    await patchWsForStubRuntime(page);

    // --- Start the task ---
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for stub to reach waiting_input
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 15_000 });

    // --- Send "fail" to trigger stub failure ---
    await inputField.fill("fail");
    await page.locator("button", { hasText: "Send" }).click();

    // --- Verify task is in failed state ---
    await expect(page.getByText("Task failed")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("button", { hasText: "Retry" })).toBeVisible();

    // --- Click Retry ---
    await page.locator("button", { hasText: "Retry" }).click();

    // --- Verify task restarts: stub runtime events appear again ---
    // The stub emits "Stub runtime initialized" on each start
    await expect(page.locator("text=in_progress")).toBeVisible({ timeout: 15_000 });

    // Wait for waiting_input and send normal input to complete
    await expect(inputField).toBeVisible({ timeout: 15_000 });
    await inputField.fill("continue");
    await page.locator("button", { hasText: "Send" }).click();

    // --- Verify task reaches review ---
    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible({ timeout: 15_000 });
  });
});
