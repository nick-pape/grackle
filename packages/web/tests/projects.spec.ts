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
    await expect(page.locator('input[placeholder="Task title..."]')).toBeVisible();

    // Description field should be a multi-line textarea
    const descriptionField = page.locator('textarea[placeholder="Description (optional)..."]');
    await expect(descriptionField).toBeVisible();

    // Main panel shows task creation prompt
    await expect(page.getByText("Fill in the task details below")).toBeVisible();

    // Fill in task details and select environment
    await page.locator('input[placeholder="Task title..."]').fill("implement feature");
    const envSelect = page.locator("select").first();
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
    await page.locator("select").first().selectOption("test-local");
    await page.locator("button", { hasText: /^Create$/ }).click();
    await expect(page.getByText("my task")).toBeVisible({ timeout: 5_000 });

    // Click task to navigate to task view
    await page.getByText("my task").click();

    // Task header should be visible with title and status
    await expect(page.locator('[data-testid="task-status"]')).toContainText("pending", { timeout: 5_000 });

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

  test("environments are accessible via Settings gear button", async ({ appPage }) => {
    const page = appPage;

    // Sidebar is now task-only (no Environments tab). Environments live in Settings.
    // Click the gear button to open Settings.
    await page.locator('button[title="Settings"]').click();

    // Should see the test-local environment in the Settings panel
    await expect(page.getByText("test-local")).toBeVisible();
  });

  // ─── Project Detail View Tests ───────────────────────────────

  /** Helper: create a project and select it in the sidebar */
  async function createAndSelectProject(page: import("@playwright/test").Page, name: string) {
    await page.locator("button", { hasText: "+" }).first().click();
    const nameInput = page.locator('input[placeholder="Project name..."]');
    await nameInput.fill(name);
    await page.locator("button", { hasText: "OK" }).click();
    await expect(page.getByText(name)).toBeVisible({ timeout: 5_000 });
    await page.getByText(name).click();
  }

  test("project detail shows metadata section", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "detail-test");

    // Project name should be visible in header
    await expect(page.locator('[data-testid="project-name"]')).toContainText("detail-test");

    // Metadata section should be visible
    await expect(page.locator('[data-testid="project-meta"]')).toBeVisible();

    // Should show labels for Description, Repository, Environment
    await expect(page.getByText("Description", { exact: true })).toBeVisible();
    await expect(page.getByText("Repository", { exact: true })).toBeVisible();
    await expect(page.getByText("Environment", { exact: true })).toBeVisible();

    // Should show placeholders for empty fields
    await expect(page.getByText("No description")).toBeVisible();
    await expect(page.getByText("No repository")).toBeVisible();
  });

  test("edit project name inline", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "name-edit-test");

    // Click pencil icon to edit name
    await page.locator('[data-testid="edit-name-button"]').click();

    // Input should appear with current name
    const nameInput = page.locator('[data-testid="edit-name-input"]');
    await expect(nameInput).toBeVisible();

    // Clear and type new name
    await nameInput.fill("renamed-project");
    await nameInput.press("Enter");

    // Name should update
    await expect(page.locator('[data-testid="project-name"]')).toContainText("renamed-project", { timeout: 5_000 });
  });

  test("cancel name edit with Escape", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "escape-test");

    // Start editing
    await page.locator('[data-testid="edit-name-button"]').click();
    const nameInput = page.locator('[data-testid="edit-name-input"]');
    await nameInput.fill("should-not-save");
    await nameInput.press("Escape");

    // Original name should still be displayed
    await expect(page.locator('[data-testid="project-name"]')).toContainText("escape-test");

    // Input should be gone
    await expect(nameInput).not.toBeVisible();
  });

  test("edit project description", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "desc-edit-test");

    // Click pencil for description
    await page.locator('[data-testid="edit-description-button"]').click();

    const descInput = page.locator('[data-testid="edit-description-input"]');
    await expect(descInput).toBeVisible();

    await descInput.fill("A new project description");
    // Blur to save (description uses blur, not Enter)
    await descInput.blur();

    // Should show the description text
    await expect(page.getByText("A new project description")).toBeVisible({ timeout: 5_000 });

    // Placeholder should be gone
    await expect(page.getByText("No description")).not.toBeVisible();
  });

  test("edit repo URL", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "repo-edit-test");

    await page.locator('[data-testid="edit-repo-button"]').click();

    const repoInput = page.locator('[data-testid="edit-repo-input"]');
    await expect(repoInput).toBeVisible();

    await repoInput.fill("https://github.com/test/repo");
    await repoInput.press("Enter");

    // Should show the repo URL as a link
    await expect(page.getByText("https://github.com/test/repo")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("No repository")).not.toBeVisible();
  });

  test("pencil edit icons are visible", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "pencil-test");

    // All edit buttons should be present
    await expect(page.locator('[data-testid="edit-name-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-description-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-repo-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-env-button"]')).toBeVisible();
  });

  test("archive project flow", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "archive-test");

    // Click Archive button
    await page.locator('[data-testid="archive-project-button"]').click();

    // Confirmation dialog should appear
    await expect(page.getByText("Archive Project?")).toBeVisible();

    // Confirm archive
    await page.getByLabel("Archive Project?").getByRole("button", { name: "Archive" }).click();

    // Project should no longer be in sidebar
    await expect(page.getByText("archive-test")).not.toBeVisible({ timeout: 5_000 });
  });

  test("change default environment", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "env-edit-test");

    // Click pencil to edit environment
    await page.locator('[data-testid="edit-env-button"]').click();

    // Select dropdown should appear
    const envSelect = page.locator('[data-testid="edit-env-select"]');
    await expect(envSelect).toBeVisible();

    // Select an environment
    await envSelect.selectOption("test-local");

    // Environment name should now be displayed
    await expect(page.getByText("test-local")).toBeVisible({ timeout: 5_000 });
  });
});
