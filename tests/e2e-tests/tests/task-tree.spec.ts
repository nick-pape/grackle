import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  getWorkspaceId,
  getTaskId,
  createTaskViaWs,
  sendWsMessage,
  sendWsAndWaitForError,
} from "./helpers.js";

test.describe("Task tree hierarchy", () => {
  test("creates a child task and displays tree structure with expand/collapse", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and root task via UI
    await createWorkspace(page, "tree-basic");
    await createTask(page, "tree-basic", "root-task", "test-local", { canDecompose: true });

    // Get IDs for WS-based child creation
    const workspaceId = await getWorkspaceId(page, "tree-basic");
    const rootTaskId = await getTaskId(page, workspaceId, "root-task");

    // Create a child task via WS
    await createTaskViaWs(page, workspaceId, "child-task", { parentTaskId: rootTaskId });

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

  test("shows child count badge on parent tasks", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "tree-badge");
    await createTask(page, "tree-badge", "badge-parent", "test-local", { canDecompose: true });

    const workspaceId = await getWorkspaceId(page, "tree-badge");
    const parentId = await getTaskId(page, workspaceId, "badge-parent");

    // Create 3 children
    await createTaskViaWs(page, workspaceId, "badge-child-1", { parentTaskId: parentId });
    await createTaskViaWs(page, workspaceId, "badge-child-2", { parentTaskId: parentId });
    await createTaskViaWs(page, workspaceId, "badge-child-3", { parentTaskId: parentId });

    // Parent should show a child count badge "0/3" (0 done out of 3)
    const parentRow = page.locator(`[data-task-id="${parentId}"]`);
    const badge = parentRow.locator('[class*="childCountBadge"]');
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toHaveText("0/3");
  });

  test("renders multi-level tree correctly", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "tree-multi");
    await createTask(page, "tree-multi", "level-0", "test-local", { canDecompose: true });

    const workspaceId = await getWorkspaceId(page, "tree-multi");
    const level0Id = await getTaskId(page, workspaceId, "level-0");

    // Create child and grandchild via WS (level-1 needs canDecompose to allow level-2)
    const level1 = await createTaskViaWs(page, workspaceId, "level-1", { parentTaskId: level0Id, canDecompose: true });
    const level1Id = level1.id as string;
    await createTaskViaWs(page, workspaceId, "level-2", { parentTaskId: level1Id });

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

  test("add child task button creates a nested child via UI", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "tree-add-child");
    await createTask(page, "tree-add-child", "ac-parent", "test-local", { canDecompose: true });

    const workspaceId = await getWorkspaceId(page, "tree-add-child");
    const parentId = await getTaskId(page, workspaceId, "ac-parent");

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

    // Child should appear in the sidebar under the parent
    await expect(page.getByText("ac-child")).toBeVisible({ timeout: 5_000 });

    // Parent should now have an expand arrow and child count badge
    const badge = parentRow.locator('[class*="childCountBadge"]');
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toHaveText("0/1");
  });

  test("prevents deletion of parent tasks with children", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "tree-del");
    await createTask(page, "tree-del", "del-parent", "test-local", { canDecompose: true });

    const workspaceId = await getWorkspaceId(page, "tree-del");
    const parentId = await getTaskId(page, workspaceId, "del-parent");

    // Create a child
    const child = await createTaskViaWs(page, workspaceId, "del-child", { parentTaskId: parentId });

    // Attempt to delete parent — should get an error
    const errorResp = await sendWsAndWaitForError(page, {
      type: "delete_task",
      payload: { taskId: parentId },
    });
    expect((errorResp.payload?.message as string) || "").toContain("children");

    // Delete child first — should succeed
    await sendWsMessage(page, { type: "delete_task", payload: { taskId: child.id } });

    // Now delete parent — should succeed
    await sendWsMessage(page, { type: "delete_task", payload: { taskId: parentId } });

    // Parent task should be gone from sidebar
    await expect(page.getByText("del-parent")).not.toBeVisible({ timeout: 5_000 });
  });

  test("breadcrumbs show ancestor chain for nested task", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "tree-bc");
    await createTask(page, "tree-bc", "bc-root", "test-local", { canDecompose: true });

    const workspaceId = await getWorkspaceId(page, "tree-bc");
    const rootId = await getTaskId(page, workspaceId, "bc-root");

    // Create a child task
    await createTaskViaWs(page, workspaceId, "bc-child", { parentTaskId: rootId });

    // Click the child task in the sidebar
    await page.getByText("bc-child").first().click();

    // Breadcrumb nav should be visible
    const breadcrumbs = page.getByTestId("breadcrumbs");
    await expect(breadcrumbs).toBeVisible({ timeout: 5_000 });

    // Should show Home > tree-bc > bc-root > bc-child
    await expect(breadcrumbs).toContainText("Home");
    await expect(breadcrumbs).toContainText("tree-bc");
    await expect(breadcrumbs).toContainText("bc-root");
    await expect(breadcrumbs).toContainText("bc-child");
  });

  test("breadcrumb click navigates to parent task", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "tree-bc-nav");
    await createTask(page, "tree-bc-nav", "nav-root", "test-local", { canDecompose: true });

    const workspaceId = await getWorkspaceId(page, "tree-bc-nav");
    const rootId = await getTaskId(page, workspaceId, "nav-root");

    await createTaskViaWs(page, workspaceId, "nav-child", { parentTaskId: rootId });

    // Navigate to child
    await page.getByText("nav-child").first().click();
    await expect(page.locator('[data-testid="task-title"]')).toContainText("nav-child", { timeout: 5_000 });

    // Click the parent task in the breadcrumb trail
    const breadcrumbs = page.getByTestId("breadcrumbs");
    await breadcrumbs.locator("a", { hasText: "nav-root" }).click();

    // Should now show the parent task
    await expect(page.locator('[data-testid="task-title"]')).toContainText("nav-root", { timeout: 5_000 });
  });
});
