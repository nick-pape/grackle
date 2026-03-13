import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("Multi-Task", () => {
  test("sidebar shows multiple tasks under a project", async ({ appPage }) => {
    const page = appPage;

    // Create project with 3 tasks
    await createProject(page, "multi-sidebar");
    await createTask(page, "multi-sidebar", "task-alpha", "test-local");
    await createTask(page, "multi-sidebar", "task-bravo", "test-local");
    await createTask(page, "multi-sidebar", "task-charlie", "test-local");

    // Verify all 3 tasks appear in the sidebar
    await expect(page.getByText("task-alpha")).toBeVisible();
    await expect(page.getByText("task-bravo")).toBeVisible();
    await expect(page.getByText("task-charlie")).toBeVisible();

    // Verify pending status icons (○) are visible for each
    const pendingIcons = page.locator("text=○");
    await expect(pendingIcons.first()).toBeVisible();
  });

  test("switching between tasks preserves state", async ({ appPage }) => {
    const page = appPage;

    // Create project with two tasks
    await createProject(page, "multi-preserve");
    await createTask(page, "multi-preserve", "preserve-task-a", "test-local");
    await createTask(page, "multi-preserve", "preserve-task-b", "test-local");

    // Navigate to task A, run it to review state
    await navigateToTask(page, "preserve-task-a");
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

    // Verify task A is in review with Approve button
    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible();

    // Navigate to task B (pending)
    await navigateToTask(page, "preserve-task-b");
    await expect(page.getByText("preserve-task-b")).toBeVisible();
    // Pending task defaults to Overview tab
    const overviewTab = page.locator("button", { hasText: "Overview" });
    await expect(overviewTab).toHaveAttribute("class", /active/, { timeout: 10_000 });

    // Navigate back to task A — should still show review state with Approve button
    await navigateToTask(page, "preserve-task-a");
    await expect(page.locator("button", { hasText: "Approve" })).toBeVisible({ timeout: 5_000 });
  });

  test("multiple projects shown simultaneously in sidebar", async ({ appPage }) => {
    const page = appPage;

    // Create two projects
    await createProject(page, "multi-proj-x");
    await createProject(page, "multi-proj-y");

    // Both should appear in the sidebar
    await expect(page.getByText("multi-proj-x")).toBeVisible();
    await expect(page.getByText("multi-proj-y")).toBeVisible();

    // Create tasks in each project
    await createTask(page, "multi-proj-x", "x-task-1", "test-local");
    await createTask(page, "multi-proj-y", "y-task-1", "test-local");

    // Expand project X by clicking it
    await page.getByText("multi-proj-x").first().click();
    await expect(page.getByText("x-task-1")).toBeVisible({ timeout: 5_000 });

    // Expand project Y by clicking it
    await page.getByText("multi-proj-y").first().click();
    await expect(page.getByText("y-task-1")).toBeVisible({ timeout: 5_000 });
  });

  test("task status badges update in sidebar during lifecycle", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "multi-badge");
    await createTask(page, "multi-badge", "badge-task", "test-local");

    // Verify pending icon (○) is shown
    await expect(page.locator("text=○").first()).toBeVisible();

    // Navigate to the task and start it
    await navigateToTask(page, "badge-task");
    await patchWsForStubRuntime(page);
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for in_progress — sidebar icon should change to ● (green)
    await expect(page.locator("text=●").first()).toBeVisible({ timeout: 15_000 });

    // Complete to review — sidebar icon should change to ◉ (yellow)
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await inputField.waitFor({ timeout: 15_000 });
    await inputField.fill("continue");
    await page.locator("button", { hasText: "Send" }).click();
    await expect(page.locator("text=◉").first()).toBeVisible({ timeout: 15_000 });

    // Approve — sidebar icon should change to ✓ (green)
    await page.locator("button", { hasText: "Approve" }).click();
    await expect(page.locator("text=✓").first()).toBeVisible({ timeout: 5_000 });
  });
});
