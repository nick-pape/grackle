import { test, expect } from "./fixtures.js";
import { createProject, createTask, navigateToTask, patchWsForStubRuntime, runStubTaskToCompletion } from "./helpers.js";

test.describe("Task Lifecycle (stub runtime)", () => {
  test("full task flow: create, start, stream, review, approve", async ({ appPage }) => {
    const page = appPage;

    // --- Step 1: Create a project ---
    await createProject(page, "lifecycle-proj");

    // --- Step 2: Create a task with test-local environment (env is set at creation via WS
    //     so it is available at start time; the UI no longer has an env dropdown) ---
    await createTask(page, "lifecycle-proj", "test task", "test-local");
    await expect(page.getByText("test task", { exact: true }).first()).toBeVisible({ timeout: 5_000 });

    // --- Step 3: Navigate to task view ---
    await page.getByText("test task", { exact: true }).click();
    await expect(page.locator('[data-testid="task-status"]')).toContainText("not_started");
    // Overview tab should be active for not_started task
    await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("class", /active/);

    // --- Step 4: Monkey-patch WS to force stub runtime on start_task ---
    await page.evaluate(() => {
      const origSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data: string | ArrayBuffer | Blob | ArrayBufferView) {
        if (typeof data === "string") {
          try {
            const msg = JSON.parse(data);
            if (msg.type === "start_task") {
              msg.payload.runtime = "stub";
              if (!msg.payload.environmentId) {
                msg.payload.environmentId = "test-local";
              }
              data = JSON.stringify(msg);
            }
          } catch { /* not JSON, pass through */ }
        }
        return origSend.call(this, data);
      };
    });

    // --- Step 5: Click "Start" ---
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // --- Step 6: Verify stub runtime events stream in ---
    // System event: "Stub runtime initialized"
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });

    // Echo event: "Echo: test task"
    await expect(page.locator("text=Echo: test task")).toBeVisible();

    // Task header should show active status (may transition to idle quickly)
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|idle/, { timeout: 5_000 });

    // --- Step 7: Session reaches idle — send input ---
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 15_000 });
    await inputField.fill("continue work");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // --- Step 8: Session completes -> task auto-moves to paused ---
    // The stub runtime completes quickly after input, auto-moving to paused.
    // The SessionPanel auto-switches to the Stream tab on paused, so we check
    // for the Complete button rather than stream content.
    await expect(page.getByRole("button", { name: "Complete", exact: true })).toBeVisible({ timeout: 15_000 });

    // UnifiedBar shows Complete button
    await expect(page.getByRole("button", { name: "Complete", exact: true })).toBeVisible({ timeout: 5_000 });

    // --- Step 9: Complete the task ---
    await page.getByRole("button", { name: "Complete", exact: true }).click();

    // Task status changes to complete
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    // "+ New Task" button appears
    await expect(page.locator("button", { hasText: "+ New Task" })).toBeVisible();
  });

  test("paused task can be completed", async ({ appPage }) => {
    const page = appPage;

    // --- Create project and task (env set via WS so it is available at start time) ---
    await createProject(page, "complete-task-proj");
    await createTask(page, "complete-task-proj", "complete task", "test-local");
    await navigateToTask(page, "complete task");
    await patchWsForStubRuntime(page);

    // Run task through to paused (review)
    await runStubTaskToCompletion(page);

    // Complete the task
    await page.getByRole("button", { name: "Complete", exact: true }).click();

    // Task should be marked complete
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    // Verify no task failure
    await expect(page.getByText("Task failed")).not.toBeVisible();
  });
});
