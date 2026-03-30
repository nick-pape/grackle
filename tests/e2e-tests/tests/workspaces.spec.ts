import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTaskDirect,
  getWorkspaceId,
  navigateToWorkspace,
  navigateToTask,
} from "./helpers.js";
import type { GrackleClient } from "./rpc-client.js";

/** Archive all existing workspaces via RPC so the welcome CTA appears. */
async function archiveAllWorkspaces(client: GrackleClient, page: import("@playwright/test").Page): Promise<void> {
  const resp = await client.listWorkspaces({});
  for (const workspace of resp.workspaces) {
    await client.archiveWorkspace({ id: workspace.id });
  }
  // Navigate to home so the UI reflects the empty state (welcome CTA is on the home page)
  await page.goto("/");
  await page.waitForFunction(
    () => document.body.innerText.includes("Connected"),
    { timeout: 10_000 },
  );
}

test.describe("Workspaces", { tag: ["@workspace"] }, () => {
  test("Environments tab shows environment nav", async ({ appPage }) => {
    const page = appPage;

    // Switch to Environments tab — environment nav visible
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await expect(page.getByTestId("environment-nav")).toBeVisible();
    await expect(page.getByTestId("env-nav-item")).toBeVisible();
  });

  test("welcome CTA navigates to create workspace page", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Ensure no workspaces exist so the welcome CTA is visible
    await archiveAllWorkspaces(client, page);

    // On fresh load (no workspaces), the welcome CTA should be visible
    await expect(page.locator('[data-testid="welcome-cta"]')).toBeVisible();

    // Wait for button to be enabled (environments must load before it's clickable)
    await expect(page.locator('[data-testid="welcome-create-button"]')).toBeEnabled({ timeout: 5_000 });
    await page.locator('[data-testid="welcome-create-button"]').click();
    await expect(page).toHaveURL(/\/workspaces\/new/);

    // Create form fields should be visible
    await expect(page.locator('[data-testid="workspace-form-name"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="workspace-form-environment"]')).toBeVisible();

    // Fill in workspace name and submit
    await page.locator('[data-testid="workspace-form-name"]').fill("cta-workspace");
    await page.locator('[data-testid="workspace-create-save"]').click();

    // Should navigate back to home
    await page.waitForURL("/", { timeout: 5_000 });

    // Navigate to the environment detail page — workspace card should appear there
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await expect(page.getByTestId("workspace-card").filter({ hasText: "cta-workspace" })).toBeVisible({ timeout: 5_000 });

    // Welcome CTA should no longer be visible (workspaces exist now — dashboard shows instead)
    await page.goto("/");
    await page.waitForFunction(() => document.body.innerText.includes("Connected"), { timeout: 10_000 });
    await expect(page.locator('[data-testid="welcome-cta"]')).not.toBeVisible({ timeout: 5_000 });
  });

  test("workspace create page cancel navigates back", async ({ appPage }) => {
    const page = appPage;

    // Navigate to the workspace create page
    await page.goto("/workspaces/new");
    await page.waitForFunction(() => document.body.innerText.includes("Connected"), { timeout: 10_000 });

    // Create form should be visible (wait for router to fully render the page)
    await expect(page.locator('[data-testid="workspace-form-name"]')).toBeVisible({ timeout: 10_000 });

    // Click cancel to go back
    await page.locator('[data-testid="workspace-create-cancel"]').click();

    // Should not be on /workspaces/new anymore
    await expect(page).not.toHaveURL(/\/workspaces\/new/);
  });


  test("create a workspace and see it on environment detail page", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create a workspace via RPC
    await createWorkspace(client, "my-workspace");

    // Navigate to environment detail page — workspace card should appear
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await expect(page.getByTestId("workspace-card").filter({ hasText: "my-workspace" })).toBeVisible({ timeout: 5_000 });
  });

  test("navigate to workspace shows empty task list and workspace view", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create a workspace via RPC and navigate to it
    await createWorkspace(client, "expand-test");
    await navigateToWorkspace(page, "expand-test");

    // Main panel shows workspace view with empty state CTA
    await expect(page.getByText("Create Task").first()).toBeVisible({ timeout: 5_000 });
  });

  test("create task from workspace page", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create a workspace via RPC and navigate to it
    await createWorkspace(client, "task-test");
    await navigateToWorkspace(page, "task-test");

    // Click the "Create Task" button on the workspace page
    await page.getByText("Create Task").first().click();

    // Full-panel TaskEditPanel should open with title and description fields
    await expect(page.locator('[data-testid="task-edit-title"]')).toBeVisible({ timeout: 5_000 });
    const descriptionField = page.locator('[data-testid="task-edit-description"]');
    await expect(descriptionField).toBeVisible();

    // No environment dropdown — environment is chosen at start time, not creation time
    await expect(page.locator('select option:has-text("test-local")')).not.toBeVisible();

    // Fill in task title and save
    await page.locator('[data-testid="task-edit-title"]').fill("implement feature");
    await page.locator('[data-testid="task-edit-save"]').click();

    // After save, navigate to tasks tab to verify task was created
    await page.locator('[data-testid="sidebar-tab-tasks"]').click();
    await expect(page.getByText("implement feature").first()).toBeVisible({ timeout: 10_000 });
  });

  test("task view shows header and tabs", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create workspace and task via RPC
    await createWorkspace(client, "view-test");
    const workspaceId = await getWorkspaceId(client, "view-test");
    await createTaskDirect(client, workspaceId, "my task");

    // Navigate to the task directly
    await navigateToTask(page, "my task");

    // Task header should be visible with title and status
    await expect(page.locator('[data-testid="task-status"]')).toContainText("not_started", { timeout: 5_000 });

    // Tab bar should show Overview, Stream, Findings
    await expect(page.getByRole("tab", { name: "Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Stream", exact: true })).toBeVisible();
    await expect(page.getByLabel("Task view").getByRole("tab", { name: "Findings", exact: true })).toBeVisible();

    // Overview tab (default for pending) should be active
    await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("class", /active/);

    // Header shows "Start" button
    await expect(page.getByTestId("task-header-start")).toBeVisible();

    // Click Findings tab — shows empty state
    await page.getByLabel("Task view").getByRole("tab", { name: "Findings", exact: true }).click();
    await expect(page.getByText("No findings yet")).toBeVisible({ timeout: 5_000 });
  });

  test("environments are accessible via Environments tab", async ({ appPage }) => {
    const page = appPage;

    // Environments have their own tab in the sidebar.
    await page.locator('[data-testid="sidebar-tab-environments"]').click();

    // Should see the test-local environment in the EnvironmentNav
    await expect(page.getByTestId("env-nav-item").filter({ hasText: "test-local" })).toBeVisible();
  });

  // ─── Workspace Detail View Tests ───────────────────────────────

  /** Helper: create a workspace via RPC and navigate to its detail page */
  async function createAndSelectWorkspace(client: GrackleClient, page: import("@playwright/test").Page, name: string) {
    await createWorkspace(client, name);
    await navigateToWorkspace(page, name);
  }

  test("workspace detail shows metadata section", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "detail-test");

    // Workspace name should be visible in header
    await expect(page.locator('[data-testid="workspace-name"]')).toContainText("detail-test");

    // Details toggle should be visible and metadata expanded by default
    await expect(page.locator('[data-testid="meta-toggle"]')).toBeVisible();
    await expect(page.locator('[data-testid="workspace-meta"]')).toBeVisible();

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

  test("edit workspace name inline", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "name-edit-test");

    await page.locator('[data-testid="edit-name-button"]').click();
    const nameInput = page.locator('[data-testid="edit-name-input"]');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toBeFocused();
    await nameInput.fill("renamed-workspace");
    await nameInput.press("Enter");

    // Input should disappear (edit mode exits)
    await expect(nameInput).not.toBeVisible({ timeout: 2_000 });

    // Name should update after server round trip
    await expect(page.locator('[data-testid="workspace-name"]')).toContainText("renamed-workspace", { timeout: 10_000 });
  });

  test("cancel name edit with Escape", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "escape-test");

    const nameInput = page.locator('[data-testid="edit-name-input"]');
    await page.locator('[data-testid="edit-name-button"]').click();
    await expect(nameInput).toBeVisible();
    await nameInput.fill("should-not-save");
    await nameInput.press("Escape");

    // Original name should still be displayed
    await expect(page.locator('[data-testid="workspace-name"]')).toContainText("escape-test");

    // Input should be gone
    await expect(nameInput).not.toBeVisible();
  });

  test("edit workspace description", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "desc-edit-test");

    const descInput = page.locator('[data-testid="edit-description-input"]');
    await page.locator('[data-testid="edit-description-button"]').click();
    await expect(descInput).toBeVisible();
    await expect(descInput).toBeFocused();
    await descInput.fill("A new workspace description");

    // Press Tab to move focus away, triggering blur and save
    await page.keyboard.press("Tab");

    // Should show the description text after server round trip
    await expect(page.getByText("A new workspace description")).toBeVisible({ timeout: 10_000 });

    // Placeholder should be gone
    await expect(page.getByText("No description")).not.toBeVisible();
  });

  test("edit repo URL", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "repo-edit-test");

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

  test("pencil edit icons are visible", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "pencil-test");

    // All edit buttons should be present
    await expect(page.locator('[data-testid="edit-name-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-description-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-repo-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="edit-env-button"]')).toBeVisible();
  });

  test("archive workspace flow", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "archive-test");

    // Click Archive button
    await page.locator('[data-testid="archive-workspace-button"]').click();

    // Confirmation dialog should appear
    await expect(page.getByText("Archive Workspace?")).toBeVisible();

    // Confirm archive
    await page.getByRole("dialog", { name: "Archive Workspace?" }).getByRole("button", { name: "Archive" }).click();

    // Should navigate away from workspace page (redirected to home)
    await expect(page.locator('[data-testid="workspace-name"]')).not.toBeVisible({ timeout: 5_000 });
  });

  test("change default environment", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "env-edit-test");

    const envSelect = page.locator('[data-testid="edit-env-select"]');
    await page.locator('[data-testid="edit-env-button"]').click();
    await expect(envSelect).toBeVisible();
    await envSelect.selectOption("test-local");

    // Environment name should now be displayed
    await expect(page.getByTestId("workspace-meta").getByText("test-local", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("click-to-edit on field values", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "click-edit-test");

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

  test("keyboard activation of edit button (Enter/Space)", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "keyboard-activate-test");

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

  test("keyboard hints shown while editing", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "hint-test");

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

  test("validation error for empty name", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "validation-test");

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

  test("validation error for invalid repo URL", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "repo-validate-test");

    await page.locator('[data-testid="edit-repo-button"]').click();
    const repoInput = page.locator('[data-testid="edit-repo-input"]');
    await repoInput.fill("not-a-url");
    await repoInput.press("Enter");

    // Should show validation error
    await expect(page.locator('[data-testid="edit-error"]')).toContainText("valid http");
    await expect(repoInput).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("collapsible metadata section", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "collapse-test");

    // Metadata should be visible by default
    await expect(page.locator('[data-testid="workspace-meta"]')).toBeVisible();

    // Click toggle to collapse
    await page.locator('[data-testid="meta-toggle"]').click();
    await expect(page.locator('[data-testid="workspace-meta"]')).not.toBeVisible();

    // Click toggle to expand again
    await page.locator('[data-testid="meta-toggle"]').click();
    await expect(page.locator('[data-testid="workspace-meta"]')).toBeVisible();
  });

  test("task progress bar appears with tasks", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await createAndSelectWorkspace(client, page, "progress-test");

    // No progress bar when no tasks
    await expect(page.locator('[data-testid="progress-bar"]')).not.toBeVisible();

    // Create a task via RPC — the app receives the WS event in real-time
    const workspaceId = await getWorkspaceId(client, "progress-test");
    await createTaskDirect(client, workspaceId, "progress task");

    // Progress bar should now be visible (app updates via WS push)
    await expect(page.locator('[data-testid="progress-bar"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="progress-bar"]')).toContainText("0/1");
  });

  // ─── Link / Unlink Environment Tests ────────────────────────────

  test("link environment via dropdown adds chip, unlink removes it", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Add a second environment so we have something to link
    const addedEnv = await client.addEnvironment({
      displayName: "link-test-env",
      adapterType: "local",
      adapterConfig: JSON.stringify({ port: 0 }),
    });
    const envId = addedEnv.id;

    // Create a workspace on test-local and navigate to it
    await createAndSelectWorkspace(client, page, "link-unlink-test");

    // Linked Envs should show "None" initially
    const linkedSection = page.getByTestId("linked-environments");
    await expect(linkedSection).toBeVisible({ timeout: 5_000 });
    await expect(linkedSection).toContainText("None");

    // Link dropdown should be visible with the second environment
    const linkSelect = page.getByTestId("link-env-select");
    await expect(linkSelect).toBeVisible();

    // Select the second environment from the dropdown
    await linkSelect.selectOption(envId);

    // Chip for the linked environment should appear
    await expect(page.getByTestId(`linked-env-${envId}`)).toBeVisible({ timeout: 10_000 });

    // "None" should no longer be visible
    await expect(linkedSection).not.toContainText("None");

    // Click the unlink (x) button on the chip
    await page.getByTestId(`unlink-env-${envId}`).click();

    // Chip should disappear and "None" should return
    await expect(page.getByTestId(`linked-env-${envId}`)).not.toBeVisible({ timeout: 10_000 });
    await expect(linkedSection).toContainText("None");
  });

  test("linked workspace appears on environment detail page with unlink button", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Add a second environment
    const addedEnv = await client.addEnvironment({
      displayName: "env-detail-link-test",
      adapterType: "local",
      adapterConfig: JSON.stringify({ port: 0 }),
    });
    const envId = addedEnv.id;

    // Create a workspace and link the second environment via RPC
    const workspaceId = await createWorkspace(client, "env-detail-ws");
    await client.linkEnvironment({ workspaceId, environmentId: envId });

    // Navigate to the second environment's detail page
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").filter({ hasText: "env-detail-link-test" }).click();

    // The linked workspace card should appear
    const linkedCard = page.getByTestId(`linked-workspace-card-${workspaceId}`);
    await expect(linkedCard).toBeVisible({ timeout: 10_000 });
    await expect(linkedCard).toContainText("env-detail-ws");

    // Unlink button should be visible
    const unlinkButton = page.getByTestId(`unlink-workspace-${workspaceId}`);
    await expect(unlinkButton).toBeVisible();
    await expect(unlinkButton).toContainText("Unlink");

    // Click unlink
    await unlinkButton.click();

    // Card should disappear
    await expect(linkedCard).not.toBeVisible({ timeout: 10_000 });

    // Empty state should appear
    await expect(page.getByTestId("linked-workspaces-empty")).toBeVisible();
  });
});
