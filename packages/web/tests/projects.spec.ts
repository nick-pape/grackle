import { test, expect } from "./fixtures.js";

test.describe("Projects", () => {
  test("sidebar defaults to Projects tab", async ({ appPage }) => {
    const page = appPage;

    // Projects tab should be active by default — header label visible
    await expect(page.locator("text=PROJECTS").first()).toBeVisible();
  });

  test("create a project and see it in sidebar", async ({ appPage }) => {
    const page = appPage;

    // Click + in the Projects header to open create form
    await page.locator("button", { hasText: "+" }).first().click();

    // Project name input appears
    const nameInput = page.locator('input[placeholder="Project name..."]');
    await expect(nameInput).toBeVisible();

    // Type project name and click OK
    await nameInput.fill("my-project");
    await page.locator("button", { hasText: "OK" }).click();

    // Project should appear in the sidebar
    await expect(page.getByText("my-project")).toBeVisible({ timeout: 5_000 });
  });

  test("expand project shows empty task list and project view", async ({ appPage }) => {
    const page = appPage;

    // Create a project
    await page.locator("button", { hasText: "+" }).first().click();
    const nameInput = page.locator('input[placeholder="Project name..."]');
    await nameInput.fill("expand-test");
    await page.locator("button", { hasText: "OK" }).click();
    await expect(page.getByText("expand-test")).toBeVisible({ timeout: 5_000 });

    // Click project to expand and select
    await page.getByText("expand-test").click();

    // Main panel shows project view with task summary (use .first() — text appears in both panel and bar)
    await expect(page.getByText("Select a task or click + to create one").first()).toBeVisible({ timeout: 5_000 });
  });

  test("create task from project", async ({ appPage }) => {
    const page = appPage;

    // Create a project
    await page.locator("button", { hasText: "+" }).first().click();
    const nameInput = page.locator('input[placeholder="Project name..."]');
    await nameInput.fill("task-test");
    await page.locator("button", { hasText: "OK" }).click();
    await expect(page.getByText("task-test")).toBeVisible({ timeout: 5_000 });

    // Click project to expand
    await page.getByText("task-test").click();

    // Click the "New task" + button scoped to this project's row
    await page.getByText("task-test").locator("..").locator('button[title="New task"]').first().click();

    // UnifiedBar should show new task form
    await expect(page.getByText("new task")).toBeVisible();
    await expect(page.locator('input[placeholder="Task title..."]')).toBeVisible();

    // Description field should be a multi-line textarea
    const descriptionField = page.locator('textarea[placeholder="Description (optional)..."]');
    await expect(descriptionField).toBeVisible();

    // Main panel shows task creation prompt
    await expect(page.getByText("Fill in the task details below")).toBeVisible();

    // Fill in task details and select environment
    await page.locator('input[placeholder="Task title..."]').fill("implement feature");
    const envSelect = page.locator("select");
    await envSelect.selectOption("test-local");

    // Click Create (exact match to avoid matching "Create Task" CTA)
    await page.locator("button", { hasText: /^Create$/ }).click();

    // Task should appear in the sidebar under the project
    await expect(page.getByText("implement feature")).toBeVisible({ timeout: 5_000 });
  });

  test("task view shows header and tabs", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await page.locator("button", { hasText: "+" }).first().click();
    const nameInput = page.locator('input[placeholder="Project name..."]');
    await nameInput.fill("view-test");
    await page.locator("button", { hasText: "OK" }).click();
    await expect(page.getByText("view-test")).toBeVisible({ timeout: 5_000 });

    await page.getByText("view-test").click();
    await page.getByText("view-test").locator("..").locator('button[title="New task"]').first().click();
    await page.locator('input[placeholder="Task title..."]').fill("my task");
    await page.locator("select").selectOption("test-local");
    await page.locator("button", { hasText: /^Create$/ }).click();
    await expect(page.getByText("my task")).toBeVisible({ timeout: 5_000 });

    // Click task to navigate to task view
    await page.getByText("my task").click();

    // Task header should be visible with title and status
    await expect(page.getByText("Task: my task")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="task-status"]')).toContainText("pending");

    // Tab bar should show Overview, Stream, Findings
    await expect(page.locator("button", { hasText: "Overview" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Stream" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Findings" })).toBeVisible();

    // Overview tab (default for pending) should be active
    await expect(page.locator("button", { hasText: "Overview" })).toHaveAttribute("class", /active/);

    // UnifiedBar shows "Start Task" button
    await expect(page.locator("button", { hasText: "Start Task" })).toBeVisible();

    // Click Findings tab — shows empty state
    await page.locator("button", { hasText: "Findings" }).click();
    await expect(page.getByText("No findings yet")).toBeVisible({ timeout: 5_000 });
  });

  test("switch between sidebar tabs", async ({ appPage }) => {
    const page = appPage;

    // Default: Projects tab is visible
    // Click Environments tab
    await page.locator("button", { hasText: "Environments" }).click();

    // Should see the test-local environment
    await expect(page.getByText("test-local")).toBeVisible();

    // Click Projects tab
    const projectsTab = page.locator("button", { hasText: "Projects" }).first();
    await projectsTab.click();

    // Environment should no longer be visible
    await expect(page.getByText("test-local")).not.toBeVisible();
  });
});
