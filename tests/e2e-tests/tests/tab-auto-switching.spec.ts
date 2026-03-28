import { test, expect } from "./fixtures.js";
import {
  createTask,
  navigateToTask,
  runStubTaskToCompletion,
} from "./helpers.js";

test.describe("Tab Auto-Switching", { tag: ["@webui"] }, () => {
  test("stream tab becomes active when task starts", async ({ stubTask }) => {
    const { page } = stubTask;

    // Create task, switch to Findings tab first
    await stubTask.createAndNavigateSimple("tab-start-task");
    await page.getByLabel("Task view").getByRole("tab", { name: "Findings" }).click();

    // Verify Findings tab content is visible
    await expect(page.getByText("No findings yet")).toBeVisible({ timeout: 10_000 });

    // Start the task with stub runtime (patched by fixture)
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for task to start running — the stream tab auto-switches and shows runtime output
    // (Status icons are now SVGs so we wait for the runtime output directly)

    // Verify Stream tab becomes active (auto-switch on in_progress)
    // Stream content should appear with runtime events
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });
  });

  test("stream tab becomes active on review state", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigateSimple("tab-review-task");

    // Start and complete the task to reach review
    await runStubTaskToCompletion(page);

    // Verify Stream tab is now active (auto-switch on review status)
    // Stream content should still be visible
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });
  });

  test("findings tab becomes active on done state", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigateSimple("tab-done-task");

    // Run through full lifecycle: start → review → approve (done)
    await runStubTaskToCompletion(page);
    await page.locator("button", { hasText: "Stop" }).click();

    // Wait for task status to update in sidebar and Findings tab to become active
    // (Status icons are now SVGs so we wait for the tab switch effect directly)
    await expect(page.getByText("No findings yet")).toBeVisible({ timeout: 10_000 });

    // Stream content should NOT be visible
    await expect(page.locator("text=Stub runtime initialized")).not.toBeVisible();
  });

  test("clicking task in sidebar resets to overview tab for pending tasks", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    // Create two tasks — first one navigates to it
    await stubTask.createAndNavigateSimple("sidebar-task-a");
    // Create second task without navigating
    await createTask(client, workspaceName, "sidebar-task-b", "test-local");

    // We're on task A — switch to Findings tab
    await page.getByLabel("Task view").getByRole("tab", { name: "Findings" }).click();

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
