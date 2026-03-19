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

    // Navigate to task, switch to Findings tab first
    await navigateToTask(page, "tab-start-task");
    await page.locator("button", { hasText: "Findings" }).click();

    // Verify Findings tab content is visible
    await expect(page.getByText("No findings yet")).toBeVisible({ timeout: 10_000 });

    // Start the task with stub runtime
    await patchWsForStubRuntime(page);
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for task status to update in sidebar (● = in_progress or ⧖ = waiting_input)
    await expect(page.locator("text=/(●|\u29D6)/").first()).toBeVisible({ timeout: 15_000 });

    // Verify Stream tab becomes active (auto-switch on in_progress)
    // Stream content should appear with runtime events
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });
  });

  test("stream tab becomes active on review state", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "tab-review");
    await createTask(page, "tab-review", "tab-review-task", "test-local");
    await navigateToTask(page, "tab-review-task");

    // Start and complete the task to reach review
    await patchWsForStubRuntime(page);
    await runStubTaskToCompletion(page);

    // Verify Stream tab is now active (auto-switch on review status)
    // Stream content should still be visible
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });
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
    await page.locator("button", { hasText: "Stop" }).click();

    // Wait for task status to update in sidebar (✓ = done)
    await expect(page.locator("text=✓").first()).toBeVisible({ timeout: 15_000 });

    // Verify Findings tab becomes active (auto-switch on done status)
    await expect(page.getByText("No findings yet")).toBeVisible({ timeout: 10_000 });

    // Stream content should NOT be visible
    await expect(page.locator("text=Stub runtime initialized")).not.toBeVisible();
  });

  test("clicking task in sidebar resets to overview tab for pending tasks", async ({ appPage }) => {
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

    // Click task B in sidebar — key prop forces SessionPanel remount, resetting to overview tab
    await navigateToTask(page, "sidebar-task-b");

    // Overview tab should be active for the pending task (not stream)
    const overviewTab = page.locator("button", { hasText: "Overview" });
    await expect(overviewTab).toHaveAttribute("class", /active/, { timeout: 10_000 });

    // Findings content should NOT be visible (switched away)
    await expect(page.getByText("No findings yet")).not.toBeVisible();
  });
});
