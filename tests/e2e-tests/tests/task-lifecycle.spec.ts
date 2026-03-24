import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTaskWithScenario,
  navigateToTask,
  patchWsForStubRuntime,
  stubScenario,
  emitText,
  emitToolUse,
  emitToolResult,
  idle,
  onInput,
} from "./helpers.js";

test.describe("Task Lifecycle (stub runtime)", { tag: ["@task", "@smoke"] }, () => {
  test("full task flow: create, start, stream, review, approve", async ({ appPage }) => {
    const page = appPage;

    // --- Step 1: Create a workspace ---
    await createWorkspace(page, "lifecycle-proj");

    // --- Step 2: Create a task with a scenario that defines exact lifecycle events ---
    await createTaskWithScenario(page, "lifecycle-proj", "test task", stubScenario(
      emitText("Working on test task..."),
      emitToolUse("echo", { message: "test task" }),
      emitToolResult('Tool output: "test task"'),
      idle(),                  // goes idle, waits for input
      onInput("next"),         // input silently advances to completion
    ));

    // --- Step 3: Navigate to task view ---
    await navigateToTask(page, "test task");
    await expect(page.locator('[data-testid="task-status"]')).toContainText("not_started");
    // Overview tab should be active for not_started task
    await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("class", /active/);

    // --- Step 4: Monkey-patch WS to force stub runtime on start_task ---
    await patchWsForStubRuntime(page);

    // --- Step 5: Click "Start" ---
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // --- Step 6: Verify scenario events stream in ---
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });
    // Use exact match to avoid matching the scenario JSON blob in the prompt content
    await expect(page.getByText("Working on test task...", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Task header should show active status (may transition to idle quickly)
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, { timeout: 5_000 });

    // --- Step 7: Session reaches idle — send input ---
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 15_000 });
    await inputField.fill("continue work");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // --- Step 8: Session completes -> task auto-moves to paused ---
    // The scenario completes after input (on_input "next" + no more steps → completed).
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({ timeout: 15_000 });

    // --- Step 9: Stop the task (kill session + mark complete) ---
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Task status changes to complete
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    // "+ New Task" button appears
    await expect(page.locator("button", { hasText: "+ New Task" })).toBeVisible();
  });

  test("paused task can be stopped (completed)", async ({ appPage }) => {
    const page = appPage;

    // --- Create workspace and task with scenario ---
    await createWorkspace(page, "complete-task-proj");
    await createTaskWithScenario(page, "complete-task-proj", "complete task", stubScenario(
      emitText("Processing..."),
      idle(),
      onInput("next"),
    ));
    await navigateToTask(page, "complete task");
    await patchWsForStubRuntime(page);

    // Start task
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for idle state, send input to advance to completed
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await inputField.waitFor({ timeout: 15_000 });
    await inputField.fill("continue");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // Wait for paused (review) state
    await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ timeout: 15_000 });

    // Stop the task (kill session + mark complete)
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Task should be marked complete
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });

    // Verify no task failure
    await expect(page.getByText("Task failed")).not.toBeVisible();
  });
});
