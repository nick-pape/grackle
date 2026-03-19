import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  createTaskViaWs,
  getWorkspaceId,
  getTaskId,
} from "./helpers.js";

test.describe("DAG View", () => {
  test("Graph tab renders task nodes after switching from default Tasks tab", async ({ appPage }) => {
    const page = appPage;

    // Create workspace with two tasks
    await createWorkspace(page, "dag-basic");
    await createTask(page, "dag-basic", "dag-task-a", "test-local");
    await createTask(page, "dag-basic", "dag-task-b", "test-local");

    // Default tab is Tasks — verify summary is visible
    await expect(page.getByText(/tasks complete/)).toBeVisible({ timeout: 5_000 });

    // Switch to Graph tab
    await page.getByRole("tab", { name: "Graph" }).click();

    // Verify task nodes appear in the graph via data-task-title attributes
    await expect(page.locator("[data-task-title='dag-task-a']")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("[data-task-title='dag-task-b']")).toBeVisible({ timeout: 5_000 });
  });

  test("Graph tab is not visible when no workspace is selected", async ({ appPage }) => {
    const page = appPage;

    // Without selecting a workspace, Graph tab should not exist
    await expect(page.getByRole("tab", { name: "Graph" })).not.toBeVisible();
  });

  test("clicking a graph node navigates to task detail", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "dag-nav");
    await createTask(page, "dag-nav", "dag-nav-task", "test-local");

    // Switch to Graph tab
    await page.getByRole("tab", { name: "Graph" }).click();

    // Click the task node in the graph
    const nodeLocator = page.locator("[data-task-title='dag-nav-task']");
    await nodeLocator.waitFor({ timeout: 5_000 });
    await nodeLocator.click();

    // Verify navigation to task detail view — task-status badge confirms we're in task view
    await expect(page.locator('[data-testid="task-status"]')).toBeVisible({ timeout: 5_000 });
  });

  test("dependency edges render for tasks with dependsOn", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "dag-deps");
    await createTask(page, "dag-deps", "dep-blocker", "test-local");

    const workspaceId = await getWorkspaceId(page, "dag-deps");
    const blockerId = await getTaskId(page, workspaceId, "dep-blocker");

    // Create dependent task via WS
    await createTaskViaWs(page, workspaceId, "dep-blocked", {
      environmentId: "test-local",
      dependsOn: [blockerId],
    });
    await page.getByText("dep-blocked").first().waitFor({ timeout: 5_000 });

    // Switch to Graph tab
    await page.getByRole("tab", { name: "Graph" }).click();

    // Verify both nodes exist in the graph
    await expect(page.locator("[data-task-title='dep-blocker']")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("[data-task-title='dep-blocked']")).toBeVisible({ timeout: 5_000 });

    // Verify the dep badge appears on the dependent node (use CSS class to avoid
    // matching the substring "dep" in the title "dep-blocked")
    const dependentNode = page.locator("[data-task-title='dep-blocked']");
    await expect(dependentNode.locator("[class*='depBadge']")).toBeVisible();
  });
});
