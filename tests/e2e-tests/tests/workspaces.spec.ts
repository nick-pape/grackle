import { test, expect } from "./fixtures.js";
import { createWorkspace, createTask, sendWsAndWaitFor, goToSettings } from "./helpers.js";

/** Archive all existing workspaces via WS so the empty state appears. */
async function archiveAllWorkspaces(page: import("@playwright/test").Page): Promise<void> {
  const response = await sendWsAndWaitFor(page, { type: "list_workspaces" }, "workspaces");
  const workspaces = (response.payload?.workspaces || []) as Array<{ id: string }>;
  for (const workspace of workspaces) {
    await sendWsAndWaitFor(
      page,
      { type: "archive_workspace", payload: { workspaceId: workspace.id } },
      "workspace.archived",
    );
  }
  if (workspaces.length > 0) {
    // Reload so the UI reflects the empty state
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
  }
}

test.describe("Sidebar shows tasks (not workspaces)", () => {
  test("sidebar header says Tasks, not WORKSPACES", async ({ appPage }) => {
    const page = appPage;

    // The sidebar header label should be "Tasks"
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar.getByText("Tasks").first()).toBeVisible({ timeout: 5_000 });

    // "WORKSPACES" label should NOT be present
    await expect(sidebar.locator("text=WORKSPACES")).not.toBeVisible();
  });

  test("tasks appear directly in sidebar without workspace grouping", async ({ appPage }) => {
    const page = appPage;

    // Create a workspace and task via WS
    await createWorkspace(page, "sidebar-ws");
    await createTask(page, "sidebar-ws", "sidebar-task-1", "test-local");

    // Task should appear directly in the sidebar
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar.getByText("sidebar-task-1")).toBeVisible({ timeout: 5_000 });

    // Workspace name should NOT appear as a sidebar row (workspaces are in Settings now)
    // It may appear as a badge, but not as a collapsible row
    await expect(sidebar.locator('button[title="New task"]')).not.toBeVisible();
  });

  test("new task button in sidebar header opens create form", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "new-btn-ws");

    // Click the "+" button in the sidebar header
    await page.locator('[data-testid="new-task-button"]').click();

    // Full-panel TaskEditPanel should open
    await expect(page.locator('[data-testid="task-edit-title"]')).toBeVisible({ timeout: 5_000 });

    // Workspace dropdown should be visible (since no workspace is pre-selected)
    await expect(page.locator('[data-testid="task-edit-workspace"]')).toBeVisible();
  });
});

test.describe("EmptyPage shows task CTA", () => {
  test("empty state prompts task creation, not workspace creation", async ({ appPage }) => {
    const page = appPage;

    // Ensure no workspaces/tasks exist
    await archiveAllWorkspaces(page);

    // The empty page should show a task-creation prompt
    // It should NOT show workspace-creation language
    await expect(page.locator("text=WORKSPACES")).not.toBeVisible();
  });
});

test.describe("Environments accessible via Settings", () => {
  test("environments are accessible via Settings gear button", async ({ appPage }) => {
    const page = appPage;

    // Click the gear button to open Settings
    await goToSettings(page);

    // Should see the test-local environment in the Settings panel
    await expect(page.getByText("test-local")).toBeVisible();
  });

  test("task view shows header and tabs", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and task
    await createWorkspace(page, "view-test");
    await createTask(page, "view-test", "my task");

    // Click task to navigate to task view
    await page.getByText("my task").click();

    // Task header should be visible with title and status
    await expect(page.locator('[data-testid="task-status"]')).toContainText("not_started", { timeout: 5_000 });

    // Tab bar should show Overview, Stream, Findings
    await expect(page.getByRole("tab", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Stream", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Findings", exact: true })).toBeVisible();

    // Overview tab (default for pending) should be active
    await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("class", /active/);

    // Header shows "Start" button
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    // Click Findings tab — shows empty state
    await page.getByRole("tab", { name: "Findings", exact: true }).click();
    await expect(page.getByText("No findings yet")).toBeVisible({ timeout: 5_000 });
  });
});
