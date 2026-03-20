import { test, expect } from "./fixtures.js";
import {
  clickSidebarWorkspace,
  createWorkspace,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
} from "./helpers.js";

test.describe("Task Retry (failed → in_progress)", () => {
  test("retry button restarts a failed task", async ({ appPage }) => {
    const page = appPage;

    // --- Setup: create workspace and task ---
    await createWorkspace(page, "retry-proj");
    await clickSidebarWorkspace(page, "retry-proj");
    await createTask(page, "retry-proj", "retry task", "test-local");
    await navigateToTask(page, "retry task");
    await patchWsForStubRuntime(page);

    // --- Start the task ---
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for stub to reach waiting_input
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 15_000 });

    // --- Send "fail" to trigger stub failure ---
    await inputField.fill("fail");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // --- Verify task is in failed state ---
    await expect(page.getByText("Task failed")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();

    // --- Click Retry ---
    await page.getByRole("button", { name: "Retry", exact: true }).click();

    // --- Verify task restarts: stub runtime events appear again ---
    // The stub emits "Stub runtime initialized" on each start
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, { timeout: 15_000 });

    // Wait for waiting_input and send normal input to complete
    await expect(inputField).toBeVisible({ timeout: 15_000 });
    await inputField.fill("continue");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // --- Verify task reaches paused (review) ---
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({ timeout: 15_000 });
  });
});
