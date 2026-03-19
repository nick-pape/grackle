import { test, expect } from "./fixtures.js";
import { createProject } from "./helpers.js";

test.describe("Projects", () => {
  test("sidebar defaults to Projects tab", async ({ appPage }) => {
    const page = appPage;

    // Projects tab should be active by default — header label visible
    await expect(page.locator("text=PROJECTS").first()).toBeVisible();
  });

  test("welcome CTA creates project inline", async ({ appPage }) => {
    const page = appPage;

    // On fresh load (no projects), the welcome CTA should be visible
    await expect(page.locator('[data-testid="welcome-cta"]')).toBeVisible();

    // Click the CTA button to show the inline form (no browser prompt())
    await page.locator('[data-testid="welcome-create-button"]').click();

    // Input should be visible and focused
    const input = page.locator('[data-testid="welcome-create-input"]');
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    // Fill in project name and click OK
    await input.fill("cta-project");
    await page.locator('[data-testid="welcome-create-ok"]').click();

    // Project should appear in sidebar
    await expect(page.getByText("cta-project")).toBeVisible({ timeout: 5_000 });

    // Welcome CTA should no longer be visible (projects exist now)
    await expect(page.locator('[data-testid="welcome-cta"]')).not.toBeVisible({ timeout: 5_000 });
  });

  test("welcome CTA cancel with Escape", async ({ appPage }) => {
    const page = appPage;

    // Click the CTA button to show the inline form
    await page.locator('[data-testid="welcome-create-button"]').click();

    // Input should be visible
    const input = page.locator('[data-testid="welcome-create-input"]');
    await expect(input).toBeVisible();

    // Press Escape to cancel
    await input.press("Escape");

    // Input should be gone, button should be back
    await expect(input).not.toBeVisible();
    await expect(page.locator('[data-testid="welcome-create-button"]')).toBeVisible();
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
    await createProject(page, name);
    await page.getByText(name).click();
  }

  test("project detail shows metadata section", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "detail-test");

    // Project name should be visible in header
    await expect(page.locator('[data-testid="project-name"]')).toContainText("detail-test");

    // Details toggle should be visible and metadata expanded by default
    await expect(page.locator('[data-testid="meta-toggle"]')).toBeVisible();
    await expect(page.locator('[data-testid="project-meta"]')).toBeVisible();

    // Should show labels for Description, Repository, Environment
    await expect(page.getByText("Description", { exact: true })).toBeVisible();
    await expect(page.getByText("Repository", { exact: true })).toBeVisible();
    await expect(page.getByText("Environment", { exact: true })).toBeVisible();

    // Should show placeholders for empty fields
    await expect(page.getByText("No description")).toBeVisible();
    await expect(page.getByText("No repository")).toBeVisible();

    // Should show timestamp
    await expect(page.getByText(/Created/)).toBeVisible();
  });

  test("edit project name inline", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "name-edit-test");

    await page.locator('[data-testid="edit-name-button"]').click();
    const nameInput = page.locator('[data-testid="edit-name-input"]');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toBeFocused();
    await nameInput.fill("renamed-project");
    await nameInput.press("Enter");

    // Input should disappear (edit mode exits)
    await expect(nameInput).not.toBeVisible({ timeout: 2_000 });

    // Name should update after server round trip
    await expect(page.locator('[data-testid="project-name"]')).toContainText("renamed-project", { timeout: 10_000 });
  });

  test("cancel name edit with Escape", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "escape-test");

    const nameInput = page.locator('[data-testid="edit-name-input"]');
    await page.locator('[data-testid="edit-name-button"]').click();
    await expect(nameInput).toBeVisible();
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

    const descInput = page.locator('[data-testid="edit-description-input"]');
    await page.locator('[data-testid="edit-description-button"]').click();
    await expect(descInput).toBeVisible();
    await expect(descInput).toBeFocused();
    await descInput.fill("A new project description");

    // Press Tab to move focus away, triggering blur and save
    await page.keyboard.press("Tab");

    // Should show the description text after server round trip
    await expect(page.getByText("A new project description")).toBeVisible({ timeout: 10_000 });

    // Placeholder should be gone
    await expect(page.getByText("No description")).not.toBeVisible();
  });

  test("edit repo URL", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "repo-edit-test");

    const repoInput = page.locator('[data-testid="edit-repo-input"]');
    await page.locator('[data-testid="edit-repo-button"]').click();
    await expect(repoInput).toBeVisible();
    await expect(repoInput).toBeFocused();
    await repoInput.fill("https://github.com/test/repo");
    await repoInput.press("Enter");

    // Input should disappear (edit mode exits)
    await expect(repoInput).not.toBeVisible({ timeout: 2_000 });

    // Should show the repo URL as a link after server round trip
    await expect(page.getByText("https://github.com/test/repo")).toBeVisible({ timeout: 10_000 });
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
    await page.getByRole("dialog", { name: "Archive Project?" }).getByRole("button", { name: "Archive" }).click();

    // Project should no longer be in sidebar
    await expect(page.getByTestId("sidebar").getByText("archive-test")).not.toBeVisible({ timeout: 5_000 });
  });

  test("change default environment", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "env-edit-test");

    const envSelect = page.locator('[data-testid="edit-env-select"]');
    await page.locator('[data-testid="edit-env-button"]').click();
    await expect(envSelect).toBeVisible();
    await envSelect.selectOption("test-local");

    // Environment name should now be displayed
    await expect(page.getByText("test-local")).toBeVisible({ timeout: 5_000 });
  });

  test("click-to-edit on field values", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "click-edit-test");

    // Clicking the value area (not just the pencil) should open edit mode
    await page.locator('[data-testid="edit-name-button"]').click();
    await expect(page.locator('[data-testid="edit-name-input"]')).toBeVisible();
    await page.keyboard.press("Escape");

    // Click description placeholder to edit
    await page.locator('[data-testid="edit-description-button"]').click();
    await expect(page.locator('[data-testid="edit-description-input"]')).toBeVisible();
    await page.keyboard.press("Escape");

    // Click repo placeholder to edit
    await page.locator('[data-testid="edit-repo-button"]').click();
    await expect(page.locator('[data-testid="edit-repo-input"]')).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("keyboard activation of edit button (Enter/Space)", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "keyboard-activate-test");

    // Focus the name edit button and press Enter to activate edit mode
    const nameButton = page.locator('[data-testid="edit-name-button"]');
    await nameButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="edit-name-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-name-input"]')).toBeFocused();
    await page.keyboard.press("Escape");

    // Focus the description edit button and press Space to activate
    const descButton = page.locator('[data-testid="edit-description-button"]');
    await descButton.focus();
    await page.keyboard.press("Space");
    await expect(page.locator('[data-testid="edit-description-input"]')).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("keyboard hints shown while editing", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "hint-test");

    // Edit name — should show keyboard hint
    await page.locator('[data-testid="edit-name-button"]').click();
    await expect(page.getByText("Enter to save")).toBeVisible();
    await expect(page.getByText("Esc to cancel")).toBeVisible();
    await page.keyboard.press("Escape");

    // Edit description — should show "Tab to save" hint
    await page.locator('[data-testid="edit-description-button"]').click();
    await expect(page.getByText("Tab to save")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("validation error for empty name", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "validation-test");

    // Edit name and clear it
    await page.locator('[data-testid="edit-name-button"]').click();
    const nameInput = page.locator('[data-testid="edit-name-input"]');
    await nameInput.fill("");
    await nameInput.press("Enter");

    // Should show validation error and stay in edit mode
    await expect(page.locator('[data-testid="edit-error"]')).toContainText("Name is required");
    await expect(nameInput).toBeVisible();

    // Escape should still cancel
    await page.keyboard.press("Escape");
    await expect(nameInput).not.toBeVisible();
  });

  test("validation error for invalid repo URL", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "repo-validate-test");

    await page.locator('[data-testid="edit-repo-button"]').click();
    const repoInput = page.locator('[data-testid="edit-repo-input"]');
    await repoInput.fill("not-a-url");
    await repoInput.press("Enter");

    // Should show validation error
    await expect(page.locator('[data-testid="edit-error"]')).toContainText("valid http");
    await expect(repoInput).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("collapsible metadata section", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "collapse-test");

    // Metadata should be visible by default
    await expect(page.locator('[data-testid="project-meta"]')).toBeVisible();

    // Click toggle to collapse
    await page.locator('[data-testid="meta-toggle"]').click();
    await expect(page.locator('[data-testid="project-meta"]')).not.toBeVisible();

    // Click toggle to expand again
    await page.locator('[data-testid="meta-toggle"]').click();
    await expect(page.locator('[data-testid="project-meta"]')).toBeVisible();
  });

  test("task progress bar appears with tasks", async ({ appPage }) => {
    const page = appPage;
    await createAndSelectProject(page, "progress-test");

    // No progress bar when no tasks
    await expect(page.locator('[data-testid="progress-bar"]')).not.toBeVisible();

    // Create a task via the full-panel form (no environment selector — env is chosen at start time)
    await page.getByText("progress-test").locator("..").locator('button[title="New task"]').first().click();
    await page.locator('[data-testid="task-edit-title"]').fill("progress task");
    await page.locator('[data-testid="task-edit-save"]').click();
    // After server confirms, the app navigates to the project view and the
    // task appears in the sidebar.
    await expect(page.getByTestId("sidebar").getByText("progress task")).toBeVisible({ timeout: 5_000 });

    // Progress bar should now be visible
    await expect(page.locator('[data-testid="progress-bar"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="progress-bar"]')).toContainText("0/1");
  });
});
