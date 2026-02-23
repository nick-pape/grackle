import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
  runStubTaskToCompletion,
} from "./helpers.js";

/** Assert a task tab button has the active styling (green text color). */
async function expectActiveTab(page: import("@playwright/test").Page, tabName: string): Promise<void> {
  const tabButton = page.locator("button", { hasText: tabName });
  // Active tabs have color: #4ecca3 = rgb(78, 204, 163)
  await expect(tabButton).toHaveCSS("color", "rgb(78, 204, 163)", { timeout: 10_000 });
}

/** Assert a task tab button has the inactive styling (gray text color). */
async function expectInactiveTab(page: import("@playwright/test").Page, tabName: string): Promise<void> {
  const tabButton = page.locator("button", { hasText: tabName });
  // Inactive tabs have color: #888 = rgb(136, 136, 136)
  await expect(tabButton).toHaveCSS("color", "rgb(136, 136, 136)");
}

test.describe("Tab Auto-Switching", () => {
  test("stream tab becomes active when task starts", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "tab-stream");
    await createTask(page, "tab-stream", "tab-start-task", "test-local");

    // Navigate to task, switch to Diff tab first
    await navigateToTask(page, "tab-start-task");
    await page.locator("button", { hasText: "Diff" }).click();
    await expectActiveTab(page, "Diff");

    // Start the task with stub runtime
    await patchWsForStubRuntime(page);
    await page.locator("button", { hasText: "Start Task" }).click();

    // Verify Stream tab becomes active (auto-switch on in_progress)
    await expectActiveTab(page, "Stream");
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });
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
    await expectActiveTab(page, "Diff");
    await expectInactiveTab(page, "Stream");
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

    // Verify Findings tab becomes active (auto-switch on done status)
    await expectActiveTab(page, "Findings");
    await expectInactiveTab(page, "Stream");
    await expectInactiveTab(page, "Diff");
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
    await expectActiveTab(page, "Findings");

    // Click task B in sidebar — should reset to Stream tab
    await navigateToTask(page, "sidebar-task-b");
    await expectActiveTab(page, "Stream");
    await expect(page.getByText("Task has not been started yet")).toBeVisible();
  });
});
