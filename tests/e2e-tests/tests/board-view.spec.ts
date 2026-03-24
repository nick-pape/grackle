import { test, expect } from "./fixtures.js";
import {
  navigateToWorkspace,
  createWorkspace,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
} from "./helpers.js";

test.describe("Board View", { tag: ["@workspace"] }, () => {
  test("Board tab is visible after selecting a workspace", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "board-tab-vis");
    await createTask(page, "board-tab-vis", "board-vis-task");
    await navigateToWorkspace(page, "board-tab-vis");

    // Board tab should be visible
    const boardTab = page.getByTestId("board-tab");
    await expect(boardTab).toBeVisible({ timeout: 5_000 });
  });

  test("Board tab is not visible when no workspace is selected", async ({ appPage }) => {
    const page = appPage;

    // Without selecting a workspace, Board tab should not exist
    await expect(page.getByTestId("board-tab")).not.toBeVisible();
  });

  test("clicking a card navigates to task detail", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "board-nav");
    await createTask(page, "board-nav", "board-nav-task");
    await navigateToWorkspace(page, "board-nav");

    // Switch to Board
    await page.getByTestId("board-tab").click();
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });

    // Click the card
    const card = page.locator("[data-testid^='board-card-']").first();
    await card.click();

    // Should navigate to task detail — task-status badge appears
    await expect(page.locator('[data-testid="task-status"]')).toBeVisible({ timeout: 5_000 });
  });

  test("card is focusable via keyboard", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "board-focus");
    await createTask(page, "board-focus", "focus-task");
    await navigateToWorkspace(page, "board-focus");

    await page.getByTestId("board-tab").click();
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });

    // Focus the card via Tab key and then activate with Enter
    const card = page.locator("[data-testid^='board-card-']").first();
    await card.focus();
    await expect(card).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="task-status"]')).toBeVisible({ timeout: 5_000 });
  });

  test("real-time update moves card between columns", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "board-realtime");
    await createTask(page, "board-realtime", "rt-task", "test-local");
    await navigateToWorkspace(page, "board-realtime");

    // Switch to board — card should be in Not Started
    await page.getByTestId("board-tab").click();
    await expect(page.getByTestId("board-container")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("board-count-not_started")).toContainText("1");
    await expect(page.getByTestId("board-count-working")).toContainText("0");

    // Navigate to the task to start it
    await navigateToTask(page, "rt-task");
    await expect(page.locator('[data-testid="task-status"]')).toContainText("not_started", { timeout: 5_000 });

    // Patch WS and start the task with stub runtime
    await patchWsForStubRuntime(page);
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for task to transition to working
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, { timeout: 15_000 });

    // Navigate back to the workspace and switch to board
    await navigateToWorkspace(page, "board-realtime");
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
