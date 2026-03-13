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

    // Full-panel TaskEditPanel should open with title and description fields
    await expect(page.locator('[data-testid="task-edit-title"]')).toBeVisible({ timeout: 5_000 });
    const descriptionField = page.locator('[data-testid="task-edit-description"]');
    await expect(descriptionField).toBeVisible();

    // No environment dropdown — environment is chosen at start time, not creation time
    await expect(page.locator('select option:has-text("test-local")')).not.toBeVisible();

    // Fill in task title and save
    await page.locator('[data-testid="task-edit-title"]').fill("implement feature");
    await page.locator('[data-testid="task-edit-save"]').click();

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

    await page.getByText("view-test").locator("..").locator('button[title="New task"]').first().click();
    await page.locator('[data-testid="task-edit-title"]').waitFor({ timeout: 5_000 });
    await page.locator('[data-testid="task-edit-title"]').fill("my task");
    await page.locator('[data-testid="task-edit-save"]').click();
    await expect(page.getByText("my task")).toBeVisible({ timeout: 5_000 });

    // Click task to navigate to task view
    await page.getByText("my task").click();

    // Task header should be visible with title and status
    await expect(page.locator('[data-testid="task-status"]')).toContainText("pending", { timeout: 5_000 });

    // Tab bar should show Overview, Stream, Findings
    await expect(page.locator("button", { hasText: "Overview" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Stream" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Findings" })).toBeVisible();

    // Overview tab (default for pending) should be active
    await expect(page.locator("button", { hasText: "Overview" })).toHaveAttribute("class", /active/);

    // Header shows "Start" button
    await expect(page.locator("button", { hasText: "Start" })).toBeVisible();

    // Click Findings tab — shows empty state
    await page.locator("button", { hasText: "Findings" }).click();
    await expect(page.getByText("No findings yet")).toBeVisible({ timeout: 5_000 });
  });

  test("environments are accessible via Settings gear button", async ({ appPage }) => {
    const page = appPage;

    // Sidebar is now task-only (no Environments tab). Environments live in Settings.
    // Click the gear button to open Settings.
    await page.locator('button[title="Settings"]').click();

    // Should see the test-local environment in the Settings panel
    await expect(page.getByText("test-local")).toBeVisible();
  });
});
