import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("Tab Auto-Switching", () => {
  test("stream tab becomes active when task starts", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "tab-stream");
    await createTask(page, "tab-stream", "tab-start-task", "test-local");

    // Navigate to task, switch to Diff tab first
    await navigateToTask(page, "tab-start-task");
    await page.locator("button", { hasText: "Diff" }).click();

    // Verify Diff tab content is visible (DiffViewer renders loading or result)
    const diffContent = page.locator("text=Loading diff...").or(
      page.locator("text=No changes on branch"),
    ).or(
      page.locator('[style*="color: rgb(233, 69, 96)"]'),
    );
    await expect(diffContent.first()).toBeVisible({ timeout: 10_000 });

    // Start the task with stub runtime
    await patchWsForStubRuntime(page);
    await page.locator("button", { hasText: "Start Task" }).click();

    // Wait for task status to update in sidebar (● = in_progress)
    await expect(page.locator("text=●").first()).toBeVisible({ timeout: 15_000 });

    // Verify Stream tab becomes active (auto-switch on in_progress)
    // Stream content should appear with runtime events
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });
  });

  test("diff tab becomes active on review state", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "tab-diff");
    await createTask(page, "tab-diff", "tab-review-task", "test-local");
    await navigateToTask(page, "tab-review-task");

    // Start and complete the task to reach review
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

    // Verify Diff tab is now active (auto-switch on review status)
    // DiffViewer should be rendering — stream content should not be visible
    const diffContent = page.locator("text=Loading diff...").or(
      page.locator("text=No changes on branch"),
    ).or(
      page.locator('[style*="color: rgb(233, 69, 96)"]'),
    );
    await expect(diffContent.first()).toBeVisible({ timeout: 10_000 });

    // Stream content should NOT be visible (tab conditionally renders)
    await expect(page.locator("text=Stub runtime initialized")).not.toBeVisible();
  });

  test("findings tab becomes active on done state", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "tab-findings");
    await createTask(page, "tab-findings", "tab-done-task", "test-local");
    await navigateToTask(page, "tab-done-task");

    // Run through full lifecycle: start → review → approve (done)
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);
    await page.locator("button", { hasText: "Approve" }).click();

    // Wait for task status to update in sidebar (✓ = done)
    await expect(page.locator("text=✓").first()).toBeVisible({ timeout: 15_000 });

    // Verify Findings tab becomes active (auto-switch on done status)
    await expect(page.getByText("No findings yet")).toBeVisible({ timeout: 10_000 });

    // Stream and Diff content should NOT be visible
    await expect(page.locator("text=Stub runtime initialized")).not.toBeVisible();
  });

  test("clicking task in sidebar resets to stream tab", async ({ appPage }) => {
    const page = appPage;

    // Create project with two tasks
    await createProject(page, "tab-sidebar");
    await createTask(page, "tab-sidebar", "sidebar-task-a", "test-local");
    await createTask(page, "tab-sidebar", "sidebar-task-b", "test-local");

    // Navigate to task A, switch to Findings tab
    await navigateToTask(page, "sidebar-task-a");
    await page.locator("button", { hasText: "Findings" }).click();

    // Verify Findings content is visible
    await expect(page.getByText("No findings yet")).toBeVisible({ timeout: 5_000 });

    // Click task B in sidebar — key prop forces SessionPanel remount, resetting to stream tab
    await navigateToTask(page, "sidebar-task-b");

    // Stream content should be visible for the pending task
    await expect(page.getByText("Task has not been started yet")).toBeVisible({ timeout: 10_000 });

    // Findings content should NOT be visible (switched away)
    await expect(page.getByText("No findings yet")).not.toBeVisible();
  });
});
