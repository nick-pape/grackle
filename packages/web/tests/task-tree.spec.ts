import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  getProjectId,
  getTaskId,
  createTaskViaWs,
  sendWsMessage,
  sendWsAndWaitForError,
} from "./helpers.js";

test.describe("Task tree hierarchy", () => {
  test("creates a child task and displays tree structure with expand/collapse", async ({ appPage }) => {
    const page = appPage;

    // Create project and root task via UI
    await createProject(page, "tree-basic");
    await createTask(page, "tree-basic", "root-task", "test-local");

    // Get IDs for WS-based child creation
    const projectId = await getProjectId(page, "tree-basic");
    const rootTaskId = await getTaskId(page, projectId, "root-task");

    // Create a child task via WS
    await createTaskViaWs(page, projectId, "child-task", { parentTaskId: rootTaskId });

    // The parent should have an expand arrow — look for the triangle character
    const expandArrow = page.locator('[class*="expandArrow"]').first();
    await expect(expandArrow).toBeVisible({ timeout: 5_000 });

    // Click expand arrow to show children
    await expandArrow.click();
    await expect(page.getByText("child-task")).toBeVisible({ timeout: 5_000 });

    // Click expand arrow again to collapse
    await expandArrow.click();
    await expect(page.getByText("child-task")).not.toBeVisible({ timeout: 5_000 });
  });

  test("shows child count badge on parent tasks", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "tree-badge");
    await createTask(page, "tree-badge", "badge-parent", "test-local");

    const projectId = await getProjectId(page, "tree-badge");
    const parentId = await getTaskId(page, projectId, "badge-parent");

    // Create 3 children
    await createTaskViaWs(page, projectId, "badge-child-1", { parentTaskId: parentId });
    await createTaskViaWs(page, projectId, "badge-child-2", { parentTaskId: parentId });
    await createTaskViaWs(page, projectId, "badge-child-3", { parentTaskId: parentId });

    // Parent should show a child count badge "0/3" (0 done out of 3)
    const badge = page.locator('[class*="childCountBadge"]').first();
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toHaveText("0/3");
  });

  test("renders multi-level tree correctly", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "tree-multi");
    await createTask(page, "tree-multi", "level-0", "test-local");

    const projectId = await getProjectId(page, "tree-multi");
    const level0Id = await getTaskId(page, projectId, "level-0");

    // Create child and grandchild via WS
    const level1 = await createTaskViaWs(page, projectId, "level-1", { parentTaskId: level0Id });
    await createTaskViaWs(page, projectId, "level-2", { parentTaskId: level1.id as string });

    // Expand level-0 to see level-1
    const expandArrow0 = page.locator('[class*="expandArrow"]').first();
    await expect(expandArrow0).toBeVisible({ timeout: 5_000 });
    await expandArrow0.click();
    await expect(page.getByText("level-1")).toBeVisible({ timeout: 5_000 });

    // Expand level-1 to see level-2
    // There should now be a second expand arrow for level-1
    const expandArrows = page.locator('[class*="expandArrow"]');
    await expect(expandArrows).toHaveCount(2, { timeout: 5_000 });
    await expandArrows.nth(1).click();
    await expect(page.getByText("level-2")).toBeVisible({ timeout: 5_000 });
  });

  test("prevents deletion of parent tasks with children", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "tree-del");
    await createTask(page, "tree-del", "del-parent", "test-local");

    const projectId = await getProjectId(page, "tree-del");
    const parentId = await getTaskId(page, projectId, "del-parent");

    // Create a child
    const child = await createTaskViaWs(page, projectId, "del-child", { parentTaskId: parentId });

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
});
