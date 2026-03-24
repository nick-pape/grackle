import { test, expect } from "./fixtures.js";
import {
  navigateToWorkspace,
  createWorkspace,
  createTask,
  navigateToTask,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("Multi-Task", { tag: ["@task"] }, () => {
  test("switching between tasks preserves state", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    // Create two tasks
    await createTask(client, workspaceName, "preserve-task-a", "test-local");
    await createTask(client, workspaceName, "preserve-task-b", "test-local");

    // Navigate to task A, run it to review state
    await navigateToTask(page, "preserve-task-a");
    await runStubTaskToCompletion(page);

    // Verify task A is in paused state (Resume only appears in paused)
    await expect(page.locator("button", { hasText: "Resume" })).toBeVisible();

    // Navigate to task B (pending)
    await navigateToTask(page, "preserve-task-b");
    await expect(page.locator('[data-testid="task-status"]')).toContainText("not_started");
    // Pending task defaults to Overview tab
    const overviewTab = page.locator("button", { hasText: "Overview" });
    await expect(overviewTab).toHaveAttribute("class", /active/, { timeout: 10_000 });

    // Navigate back to task A — should still show paused state
    await navigateToTask(page, "preserve-task-a");
    await expect(page.locator("button", { hasText: "Resume" })).toBeVisible({ timeout: 5_000 });
  });

  test("multiple workspaces with tasks are navigable via board", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    // Use the fixture workspace as workspace X, create workspace Y manually
    await createTask(client, workspaceName, "x-task-1", "test-local");

    await createWorkspace(client, "multi-proj-y");
    await createTask(client, "multi-proj-y", "y-task-1", "test-local");

    // Navigate to workspace X board — task card should be visible
    await navigateToWorkspace(page, workspaceName);
    await page.getByTestId("board-tab").click();
    await expect(page.getByText("x-task-1")).toBeVisible({ timeout: 5_000 });

    // Navigate to workspace Y board — task card should be visible
    await navigateToWorkspace(page, "multi-proj-y");
    await page.getByTestId("board-tab").click();
    await expect(page.getByText("y-task-1")).toBeVisible({ timeout: 5_000 });
  });

  test("task status badges update during lifecycle", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    // Create task
    await createTask(client, workspaceName, "badge-task", "test-local");

    // Navigate to the task and start it
    await navigateToTask(page, "badge-task");
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for active state — task status should change to working or paused
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, { timeout: 15_000 });

    // Complete to review
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await inputField.waitFor({ timeout: 15_000 });
    await inputField.fill("continue");
    await page.locator("button", { hasText: "Send" }).click();

    // Wait for paused (review) state
    await page.locator("button", { hasText: "Resume" }).waitFor({ timeout: 15_000 });

    // Complete — stop the task
    await page.locator("button", { hasText: "Stop" }).click();
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });
  });
});
