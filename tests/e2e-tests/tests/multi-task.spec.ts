import { test, expect } from "./fixtures.js";
import {
  navigateToWorkspace,
  createWorkspace,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("Multi-Task", { tag: ["@task"] }, () => {
  test("tasks sidebar shows multiple tasks", async ({ appPage }) => {
    const page = appPage;

    // Create workspace with 3 tasks
    await createWorkspace(page, "multi-sidebar");
    await createTask(page, "multi-sidebar", "task-alpha", "test-local");
    await createTask(page, "multi-sidebar", "task-bravo", "test-local");
    await createTask(page, "multi-sidebar", "task-charlie", "test-local");

    // Navigate to Tasks tab — all 3 tasks should appear in the sidebar
    await page.locator('[data-testid="sidebar-tab-tasks"]').click();
    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar.getByText("task-alpha")).toBeVisible({ timeout: 5_000 });
    await expect(sidebar.getByText("task-bravo")).toBeVisible({ timeout: 5_000 });
    await expect(sidebar.getByText("task-charlie")).toBeVisible({ timeout: 5_000 });
  });

  // FIXME: session recovery race — auto-reconnect tries to reanimate suspended sessions
  // that conflict with active sessions, causing stub task switching to fail.
  test.fixme("switching between tasks preserves state", async ({ appPage }) => {
    const page = appPage;

    // Create workspace with two tasks
    await createWorkspace(page, "multi-preserve");
    await createTask(page, "multi-preserve", "preserve-task-a", "test-local");
    await createTask(page, "multi-preserve", "preserve-task-b", "test-local");

    // Navigate to task A, run it to review state
    await navigateToTask(page, "preserve-task-a");
    await patchWsForStubRuntime(page);
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

  test("multiple workspaces with tasks are navigable via board", async ({ appPage }) => {
    const page = appPage;

    // Create two workspaces with tasks
    await createWorkspace(page, "multi-proj-x");
    await createWorkspace(page, "multi-proj-y");
    await createTask(page, "multi-proj-x", "x-task-1", "test-local");
    await createTask(page, "multi-proj-y", "y-task-1", "test-local");

    // Navigate to workspace X board — task card should be visible
    await navigateToWorkspace(page, "multi-proj-x");
    await page.getByTestId("board-tab").click();
    await expect(page.getByText("x-task-1")).toBeVisible({ timeout: 5_000 });

    // Navigate to workspace Y board — task card should be visible
    await navigateToWorkspace(page, "multi-proj-y");
    await page.getByTestId("board-tab").click();
    await expect(page.getByText("y-task-1")).toBeVisible({ timeout: 5_000 });
  });

  test("task status badges update during lifecycle", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and task
    await createWorkspace(page, "multi-badge");
    await createTask(page, "multi-badge", "badge-task", "test-local");

    // Navigate to the task and start it
    await navigateToTask(page, "badge-task");
    await patchWsForStubRuntime(page);
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
