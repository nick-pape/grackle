import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  navigateToTask,
  getWorkspaceId,
  getTaskId,
  createTaskDirect,
} from "./helpers.js";
import type { GrackleClient } from "./rpc-client.js";

/** Navigate to the Tasks sidebar tab so the TaskList with tree structure is visible. */
async function goToTasksTab(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('[data-testid="sidebar-tab-tasks"]').click();
}

test.describe("Task tree hierarchy", { tag: ["@task"] }, () => {
  test("creates a child task and displays tree structure with expand/collapse", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create workspace and root task via RPC
    await createWorkspace(client, "tree-basic");
    await createTask(client, "tree-basic", "root-task", "test-local", { canDecompose: true });

    // Navigate to Tasks tab so the task tree is visible in the sidebar
    await goToTasksTab(page);

    // Get IDs for child creation
    const workspaceId = await getWorkspaceId(client, "tree-basic");
    const rootTaskId = await getTaskId(client, workspaceId, "root-task");

    // Create a child task via RPC
    await createTaskDirect(client, workspaceId, "child-task", { parentTaskId: rootTaskId });

    // Scope expand arrow to the task row using data-task-id attribute
    const rootRow = page.locator(`[data-task-id="${rootTaskId}"]`);
    const expandArrow = rootRow.locator('[class*="expandArrow"]');
    await expect(expandArrow).toBeVisible({ timeout: 5_000 });

    // Click expand arrow to show children (auto-expand may already have opened it)
    // First ensure child is visible
    await expect(page.getByText("child-task")).toBeVisible({ timeout: 5_000 });

    // Click expand arrow to collapse
    await expandArrow.click();
    await expect(page.getByText("child-task")).not.toBeVisible({ timeout: 5_000 });

    // Click expand arrow again to re-expand
    await expandArrow.click();
    await expect(page.getByText("child-task")).toBeVisible({ timeout: 5_000 });
  });

  test("shows child count badge on parent tasks", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await createWorkspace(client, "tree-badge");
    await createTask(client, "tree-badge", "badge-parent", "test-local", { canDecompose: true });

    // Navigate to Tasks tab
    await goToTasksTab(page);

    const workspaceId = await getWorkspaceId(client, "tree-badge");
    const parentId = await getTaskId(client, workspaceId, "badge-parent");

    // Create 3 children
    await createTaskDirect(client, workspaceId, "badge-child-1", { parentTaskId: parentId });
    await createTaskDirect(client, workspaceId, "badge-child-2", { parentTaskId: parentId });
    await createTaskDirect(client, workspaceId, "badge-child-3", { parentTaskId: parentId });

    // Parent should show a child count badge "0/3" (0 done out of 3)
    const parentRow = page.locator(`[data-task-id="${parentId}"]`);
    const badge = parentRow.locator('[class*="childCountBadge"]');
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toHaveText("0/3");
  });

  test("renders multi-level tree correctly", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await createWorkspace(client, "tree-multi");
    await createTask(client, "tree-multi", "level-0", "test-local", { canDecompose: true });

    // Navigate to Tasks tab
    await goToTasksTab(page);

    const workspaceId = await getWorkspaceId(client, "tree-multi");
    const level0Id = await getTaskId(client, workspaceId, "level-0");

    // Create child and grandchild via RPC (level-1 needs canDecompose to allow level-2)
    const level1 = await createTaskDirect(client, workspaceId, "level-1", { parentTaskId: level0Id, canDecompose: true });
    const level1Id = level1.id as string;
    await createTaskDirect(client, workspaceId, "level-2", { parentTaskId: level1Id });

    // Auto-expand should show level-1 already; verify it's visible
    await expect(page.getByText("level-1")).toBeVisible({ timeout: 5_000 });

    // level-1 should auto-expand too; verify level-2 is visible
    await expect(page.getByText("level-2")).toBeVisible({ timeout: 5_000 });

    // Collapse level-0 to hide both descendants
    const level0Row = page.locator(`[data-task-id="${level0Id}"]`);
    await level0Row.locator('[class*="expandArrow"]').click();
    await expect(page.getByText("level-1")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("level-2")).not.toBeVisible({ timeout: 5_000 });

    // Re-expand level-0
    await level0Row.locator('[class*="expandArrow"]').click();
    await expect(page.getByText("level-1")).toBeVisible({ timeout: 5_000 });
  });

  test("add child task button creates a nested child via UI", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await createWorkspace(client, "tree-add-child");
    await createTask(client, "tree-add-child", "ac-parent", "test-local", { canDecompose: true });

    // Navigate to Tasks tab
    await goToTasksTab(page);

    const workspaceId = await getWorkspaceId(client, "tree-add-child");
    const parentId = await getTaskId(client, workspaceId, "ac-parent");

    // Hover over the parent task row to reveal the add-child "+" button
    const parentRow = page.locator(`[data-task-id="${parentId}"]`);
    await parentRow.hover();

    // Click the add-child button
    const addChildButton = parentRow.locator('[aria-label="Add child task"]');
    await expect(addChildButton).toBeVisible({ timeout: 5_000 });
    await addChildButton.click();

    // Full-panel TaskEditPanel should open for the child task
    await expect(page.locator('[data-testid="task-edit-title"]')).toBeVisible({ timeout: 5_000 });

    // Fill in child task title and save
    await page.locator('[data-testid="task-edit-title"]').fill("ac-child");
    await page.locator('[data-testid="task-edit-save"]').click();

    // Wait for the edit panel to close, confirming the save round-trip completed
    await expect(page.locator('[data-testid="task-edit-title"]')).not.toBeVisible({ timeout: 5_000 });

    // Navigate back to Tasks tab to see the updated tree
    await goToTasksTab(page);

    // Child should appear in the task list
    await expect(page.getByText("ac-child")).toBeVisible({ timeout: 5_000 });

    // Re-locate parent row (DOM may have re-rendered after navigation)
    const updatedParentRow = page.locator(`[data-task-id="${parentId}"]`);

    // Parent should now have an expand arrow and child count badge
    const badge = updatedParentRow.locator('[class*="childCountBadge"]');
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toHaveText("0/1");
  });

  test("prevents deletion of parent tasks with children", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await createWorkspace(client, "tree-del");
    await createTask(client, "tree-del", "del-parent", "test-local", { canDecompose: true });

    // Navigate to Tasks tab so tasks are visible
    await goToTasksTab(page);

    const workspaceId = await getWorkspaceId(client, "tree-del");
    const parentId = await getTaskId(client, workspaceId, "del-parent");

    // Create a child
    const child = await createTaskDirect(client, workspaceId, "del-child", { parentTaskId: parentId });

    // Attempt to delete parent — should get an error
    let error: Error | undefined;
    try {
      await client.deleteTask({ id: parentId });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain("children");

    // Delete child first — should succeed
    await client.deleteTask({ id: child.id as string });

    // Now delete parent — should succeed
    await client.deleteTask({ id: parentId });

    // Parent task should be gone from the page
    await expect(page.getByText("del-parent")).not.toBeVisible({ timeout: 5_000 });
  });

  test("breadcrumbs show ancestor chain for nested task", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await createWorkspace(client, "tree-bc");
    await createTask(client, "tree-bc", "bc-root", "test-local", { canDecompose: true });

    const workspaceId = await getWorkspaceId(client, "tree-bc");
    const rootId = await getTaskId(client, workspaceId, "bc-root");

    // Create a child task
    await createTaskDirect(client, workspaceId, "bc-child", { parentTaskId: rootId });

    // Navigate to the child task
    await navigateToTask(page, "bc-child");

    // Breadcrumb nav should be visible
    const breadcrumbs = page.getByTestId("breadcrumbs");
    await expect(breadcrumbs).toBeVisible({ timeout: 5_000 });

    // Should show Home > tree-bc > bc-root > bc-child
    await expect(breadcrumbs).toContainText("Home");
    await expect(breadcrumbs).toContainText("tree-bc");
    await expect(breadcrumbs).toContainText("bc-root");
    await expect(breadcrumbs).toContainText("bc-child");
  });

  test("breadcrumb click navigates to parent task", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await createWorkspace(client, "tree-bc-nav");
    await createTask(client, "tree-bc-nav", "nav-root", "test-local", { canDecompose: true });

    const workspaceId = await getWorkspaceId(client, "tree-bc-nav");
    const rootId = await getTaskId(client, workspaceId, "nav-root");

    await createTaskDirect(client, workspaceId, "nav-child", { parentTaskId: rootId });

    // Navigate to child
    await navigateToTask(page, "nav-child");
    await expect(page.locator('[data-testid="task-title"]')).toContainText("nav-child", { timeout: 5_000 });

    // Click the parent task in the breadcrumb trail
    const breadcrumbs = page.getByTestId("breadcrumbs");
    await breadcrumbs.locator("a", { hasText: "nav-root" }).click();

    // Should now show the parent task
    await expect(page.locator('[data-testid="task-title"]')).toContainText("nav-root", { timeout: 5_000 });
  });
});
