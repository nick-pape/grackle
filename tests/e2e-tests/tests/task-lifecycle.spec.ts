import { test, expect } from "./fixtures.js";
import { stubScenario, emitText, emitToolUse, emitToolResult, idle, onInput } from "./helpers.js";

test.describe("Task Lifecycle (stub runtime)", { tag: ["@task", "@smoke"] }, () => {
  test("full task flow: create, start, stream, review, approve", async ({ stubTask }) => {
    const { page } = stubTask;

    // --- Step 1+2: Create a task with a scenario that defines exact lifecycle events ---
    await stubTask.createAndNavigate(
      "test task",
      stubScenario(
        emitText("Working on test task..."),
        emitToolUse("echo", { message: "test task" }),
        emitToolResult('Tool output: "test task"'),
        onInput("next"), // input silently advances to completion
        idle(), // goes idle, waits for input
      ),
    );

    // --- Step 3: Verify initial state ---
    await expect(page.locator('[data-testid="task-status"]')).toContainText("not_started");
    // Overview tab should be active for not_started task
    await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
      "class",
      /active/,
    );

    // --- Step 4: Click "Start" (stub runtime patched by fixture) ---
    await page.getByTestId("task-header-start").click();

    // --- Step 5: Verify scenario events stream in ---
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });
    // Use exact match to avoid matching the scenario JSON blob in the prompt content
    await expect(page.getByText("Working on test task...", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Task header should show active status (may transition to idle quickly)
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, {
      timeout: 5_000,
    });

    // --- Step 6: Session reaches idle — send input ---
    const inputField = page.locator('textarea[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 15_000 });
    await inputField.fill("continue work");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // --- Step 7: Session completes -> task auto-moves to paused ---
    // The scenario completes after input (on_input "next" + no more steps → completed).
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // --- Step 8: Stop the task — pauses it, does NOT complete it (#1356) ---
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Task stays paused (resumable), not complete
    await expect(page.locator('[data-testid="task-status"]')).toContainText("paused", {
      timeout: 5_000,
    });
    await expect(page.getByText("Task completed")).not.toBeVisible();
    // Resume remains available — the session is stopped, so the task is resumable
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  });

  test("paused task can be stopped without completing it", async ({ stubTask }) => {
    const { page } = stubTask;

    // --- Create task with scenario ---
    await stubTask.createAndNavigate(
      "complete task",
      stubScenario(emitText("Processing..."), onInput("next"), idle()),
    );

    // Start task
    await page.getByTestId("task-header-start").click();

    // Wait for idle state, send input to advance to completed
    const inputField = page.locator('textarea[placeholder="Type a message..."]');
    await inputField.waitFor({ timeout: 15_000 });
    await inputField.fill("continue");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // Wait for paused (review) state
    await expect(page.locator('[data-testid="task-status"]')).toContainText("paused", {
      timeout: 15_000,
    });

    // Stop the task — pauses it (does NOT complete it — #1356)
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Task stays paused, never complete or failed
    await expect(page.locator('[data-testid="task-status"]')).toContainText("paused", {
      timeout: 5_000,
    });
    await expect(page.getByText("Task completed")).not.toBeVisible();
    await expect(page.getByText("Task failed")).not.toBeVisible();
  });
});
