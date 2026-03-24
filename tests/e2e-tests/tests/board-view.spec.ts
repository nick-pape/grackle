import { test, expect } from "./fixtures.js";
import {
  navigateToWorkspace,
  createWorkspace,
  createTask,
  createTaskViaWs,
  getWorkspaceId,
  getTaskId,
  navigateToTask,
} from "./helpers.js";

test.describe("Board View", { tag: ["@workspace"] }, () => {
  test("Board tab is visible after selecting a workspace", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    await createTask(page, workspaceName, "board-vis-task");
    await navigateToWorkspace(page, workspaceName);

    // Board tab should be visible
    const boardTab = page.getByTestId("board-tab");
    await expect(boardTab).toBeVisible({ timeout: 5_000 });
  });

  test("Board tab is not visible when no workspace is selected", async ({ appPage }) => {
    const page = appPage;

    // Without selecting a workspace, Board tab should not exist
    await expect(page.getByTestId("board-tab")).not.toBeVisible();
  });

  test("empty workspace shows CTA on board view", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    await navigateToWorkspace(page, workspaceName);

    // Navigate to board tab
    await page.getByTestId("board-tab").click();

    // Should show empty CTA
    await expect(page.getByTestId("board-empty-cta")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("board-empty-cta").getByRole("button", { name: "Create Task" })).toBeVisible();
  });

  test("tasks appear in correct columns based on status", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    await createTask(page, workspaceName, "col-task-a");
    await createTask(page, workspaceName, "col-task-b");
    await navigateToWorkspace(page, workspaceName);

    // Switch to Board tab
    await page.getByTestId("board-tab").click();

    // Verify board container is visible
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });

    // Both tasks should be in the Not Started column (default status)
    const notStartedColumn = page.getByTestId("board-column-not_started");
    await expect(notStartedColumn).toBeVisible();

    // Verify count badge shows 2
    await expect(page.getByTestId("board-count-not_started")).toContainText("2");

    // Other columns should show 0
    await expect(page.getByTestId("board-count-working")).toContainText("0");
    await expect(page.getByTestId("board-count-complete")).toContainText("0");
  });

  test("all five columns are always rendered", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    await createTask(page, workspaceName, "all-cols-task");
    await navigateToWorkspace(page, workspaceName);

    await page.getByTestId("board-tab").click();
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });

    // All five columns should be present
    await expect(page.getByTestId("board-column-not_started")).toBeVisible();
    await expect(page.getByTestId("board-column-working")).toBeVisible();
    await expect(page.getByTestId("board-column-paused")).toBeVisible();
    await expect(page.getByTestId("board-column-complete")).toBeVisible();
    await expect(page.getByTestId("board-column-failed")).toBeVisible();
  });

  test("clicking a card navigates to task detail", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    await createTask(page, workspaceName, "board-nav-task");
    await navigateToWorkspace(page, workspaceName);

    // Switch to Board
    await page.getByTestId("board-tab").click();
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });

    // Click the card
    const card = page.locator("[data-testid^='board-card-']").first();
    await card.click();

    // Should navigate to task detail — task-status badge appears
    await expect(page.locator('[data-testid="task-status"]')).toBeVisible({ timeout: 5_000 });
  });

  test("card is focusable via keyboard", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    await createTask(page, workspaceName, "focus-task");
    await navigateToWorkspace(page, workspaceName);

    await page.getByTestId("board-tab").click();
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });

    // Focus the card via Tab key and then activate with Enter
    const card = page.locator("[data-testid^='board-card-']").first();
    await card.focus();
    await expect(card).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="task-status"]')).toBeVisible({ timeout: 5_000 });
  });

  test("blocked task shows blocked badge in its status column", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    await createTask(page, workspaceName, "blocker-task");

    const workspaceId = await getWorkspaceId(page, workspaceName);
    const blockerId = await getTaskId(page, workspaceId, "blocker-task");

    // Create a dependent task
    await createTaskViaWs(page, workspaceId, "blocked-task", {
      dependsOn: [blockerId],
    });

    // Navigate to workspace page to see board
    await navigateToWorkspace(page, workspaceName);

    // Switch to board
    await page.getByTestId("board-tab").click();
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });

    // The blocked task should still be in Not Started column (not a separate column)
    await expect(page.getByTestId("board-count-not_started")).toContainText("2");

    // And it should have a "blocked" badge on the card
    const blockedBadge = page.locator("[data-testid^='board-card-']").filter({ hasText: "blocked" });
    await expect(blockedBadge).toBeVisible({ timeout: 5_000 });
  });

  test("child progress badge shows on parent cards", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    const workspaceId = await getWorkspaceId(page, workspaceName);
    const parentTask = await createTaskViaWs(page, workspaceId, "parent-task", { canDecompose: true });
    const parentId = parentTask.id as string;

    // Create child tasks
    await createTaskViaWs(page, workspaceId, "child-1", { parentTaskId: parentId });
    await createTaskViaWs(page, workspaceId, "child-2", { parentTaskId: parentId });

    // Navigate to workspace page to see board
    await navigateToWorkspace(page, workspaceName);

    // Switch to board
    await page.getByTestId("board-tab").click();
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });

    // Parent card should show child progress badge "0/2"
    const parentCard = page.locator("[data-testid^='board-card-']").filter({ hasText: "parent-task" });
    await expect(parentCard.locator("text=0/2")).toBeVisible({ timeout: 5_000 });
  });

  test("real-time update moves card between columns", async ({ stubTask }) => {
    const { page, workspaceName } = stubTask;

    await createTask(page, workspaceName, "rt-task", "test-local");
    await navigateToWorkspace(page, workspaceName);

    // Switch to board — card should be in Not Started
    await page.getByTestId("board-tab").click();
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("board-count-not_started")).toContainText("1");
    await expect(page.getByTestId("board-count-working")).toContainText("0");

    // Navigate to the task to start it (stub runtime patched by fixture)
    await navigateToTask(page, "rt-task");
    await expect(page.locator('[data-testid="task-status"]')).toContainText("not_started", { timeout: 5_000 });

    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for task to transition to working
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, { timeout: 15_000 });

    // Navigate back to the workspace and switch to board
    await navigateToWorkspace(page, workspaceName);
    await page.getByTestId("board-tab").click();
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });

    // The card should have moved out of Not Started
    await expect(page.getByTestId("board-count-not_started")).toContainText("0", { timeout: 5_000 });

    // And into Working or Paused (stub runtime may transition quickly)
    const workingCount = await page.getByTestId("board-count-working").textContent();
    const pausedCount = await page.getByTestId("board-count-paused").textContent();
    expect(Number(workingCount) + Number(pausedCount)).toBeGreaterThan(0);
  });
});
