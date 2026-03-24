import { test, expect } from "./fixtures.js";
import {
  navigateToWorkspace,
  createWorkspace,
  createTask,
  navigateToTask,
  getWorkspaceId,
  getTaskId,
  createTaskDirect,
} from "./helpers.js";
import type { GrackleClient } from "./rpc-client.js";

test.describe("Unified task create/edit experience", { tag: ["@task"] }, () => {
  // "clicking Create Task opens full-panel form" removed — covered by TaskEditPanel.stories.tsx (FormFieldsVisible).

  test("creating a task via the panel fills title and description, then navigates to workspace", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createWorkspace(client, "create-full-proj");
    await navigateToWorkspace(page, "create-full-proj");

    // Open new task form
    await page.getByText("Create Task").first().click();

    await page.locator('[data-testid="task-edit-title"]').fill("panel-created-task");
    await page.locator('[data-testid="task-edit-description"]').fill("A description with **markdown**");

    // Save button enabled once title is provided
    await expect(page.locator('[data-testid="task-edit-save"]')).toBeEnabled();
    await page.locator('[data-testid="task-edit-save"]').click();

    // After saving, navigate to the task to verify it was created
    await navigateToTask(page, "panel-created-task");
    await expect(page.locator('[data-testid="task-title"]')).toContainText("panel-created-task");
    // Description markdown should render (strong tag from **markdown**)
    await expect(page.locator('.overviewMarkdown, [class*="overviewMarkdown"]')).toBeVisible({ timeout: 5_000 });
  });

  test("Cancel button in new task form returns to workspace view", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createWorkspace(client, "cancel-create-proj");
    await navigateToWorkspace(page, "cancel-create-proj");

    // Open new task form
    await page.getByText("Create Task").first().click();

    await expect(page.locator('[data-testid="task-edit-title"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="task-edit-title"]').fill("will not be saved");

    // Click Cancel
    await page.locator("button", { hasText: "Cancel" }).click();

    // Should return to workspace view (no task created)
    await expect(page.locator('[data-testid="task-edit-title"]')).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("will not be saved", { exact: true })).not.toBeVisible();
  });

  test("pending task header shows an Edit button", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createWorkspace(client, "edit-btn-proj");
    await createTask(client, "edit-btn-proj", "edit-btn-task", "test-local");

    // Navigate to the task
    await navigateToTask(page, "edit-btn-task");

    // Edit button should be visible in the task header
    await expect(page.locator("button", { hasText: /^Edit$/ })).toBeVisible({ timeout: 5_000 });
  });

  test("clicking Edit opens the edit form pre-populated with existing task data", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createWorkspace(client, "edit-form-proj");
    const workspaceId = await getWorkspaceId(client, "edit-form-proj");

    // Create task with description via RPC so we can verify pre-population
    await createTaskDirect(client, workspaceId, "editable-task", {
      environmentId: "test-local",
      description: "Original description",
    });

    // Navigate directly to the task via URL lookup
    await navigateToTask(page, "editable-task");

    // Click Edit
    await page.locator("button", { hasText: /^Edit$/ }).click();

    // Edit form should be visible and pre-populated
    await expect(page.locator('[data-testid="task-edit-title"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="task-edit-title"]')).toHaveValue("editable-task");
    await expect(page.locator('[data-testid="task-edit-description"]')).toHaveValue("Original description");

    // Save button should be labeled "Save Changes"
    await expect(page.locator('[data-testid="task-edit-save"]')).toHaveText("Save Changes");
  });

  test("saving edits updates the task title and description", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createWorkspace(client, "save-edit-proj");
    const workspaceId = await getWorkspaceId(client, "save-edit-proj");

    await createTaskDirect(client, workspaceId, "old-title-task", {
      environmentId: "test-local",
      description: "Old description",
    });

    // Navigate directly to the task via URL lookup
    await navigateToTask(page, "old-title-task");

    // Click Edit
    await page.locator("button", { hasText: /^Edit$/ }).click();

    // Update title and description
    await page.locator('[data-testid="task-edit-title"]').fill("new-title-task");
    await page.locator('[data-testid="task-edit-description"]').fill("Updated description");
    await page.locator('[data-testid="task-edit-save"]').click();

    // Should navigate back to task view with updated title
    await expect(page.locator('[data-testid="task-title"]')).toContainText("new-title-task", { timeout: 5_000 });

    // Updated title should appear on the page
    await expect(page.getByText("new-title-task", { exact: true }).first()).toBeVisible({ timeout: 5_000 });
  });

  // "task creation form has no environment dropdown" removed — covered by TaskEditPanel.stories.tsx (NoEnvironmentDropdown).

  test("task edit form shows dependency multi-select with sibling tasks", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createWorkspace(client, "deps-edit-proj");
    const workspaceId = await getWorkspaceId(client, "deps-edit-proj");

    // Create two tasks
    await createTaskDirect(client, workspaceId, "task-alpha-dep", { environmentId: "test-local" });
    await createTaskDirect(client, workspaceId, "task-beta-dep", { environmentId: "test-local" });

    // Navigate directly to task-beta and edit
    await navigateToTask(page, "task-beta-dep");
    await page.locator("button", { hasText: /^Edit$/ }).click();

    await expect(page.locator('[data-testid="task-edit-title"]')).toBeVisible({ timeout: 5_000 });

    // task-alpha should appear as an option in the dependency list
    await expect(page.locator('[data-testid^="dep-option-"]', { hasText: "task-alpha-dep" })).toBeVisible({ timeout: 5_000 });

    // Select task-alpha as a dependency
    const alphaId = await getTaskId(client, workspaceId, "task-alpha-dep");
    await page.locator(`[data-testid="dep-option-${alphaId}"] input[type="checkbox"]`).check();

    // Save
    await page.locator('[data-testid="task-edit-save"]').click();

    // Navigate back and verify dependency shown in overview
    await navigateToTask(page, "task-beta-dep");
    await expect(page.getByText("task-alpha-dep").first()).toBeVisible({ timeout: 5_000 });
  });
});
