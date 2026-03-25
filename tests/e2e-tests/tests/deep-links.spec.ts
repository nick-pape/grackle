import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  getWorkspaceId,
  getTaskId,
  navigateToWorkspace,
} from "./helpers.js";

test.describe("Deep linking", { tag: ["@webui"] }, () => {
  test("deep link to /settings loads settings page", async ({ appPage }) => {
    const page = appPage;

    await page.goto("/settings");
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
  });

  test("deep link to /workspaces/:id loads workspace", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create a workspace via WS
    await createWorkspace(client, "deep-link-proj");
    const workspaceId = await getWorkspaceId(client, "deep-link-proj");

    // Navigate away then deep link directly
    await page.goto(`/workspaces/${workspaceId}`);
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // The workspace page should be visible (workspace name in header)
    await expect(page.getByText("deep-link-proj").first()).toBeVisible({ timeout: 5_000 });
  });

  test("deep link to /tasks/:id loads task detail", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create workspace and task via WS
    await createWorkspace(client, "deep-link-task-proj");
    const workspaceId = await getWorkspaceId(client, "deep-link-task-proj");
    await createTask(client, "deep-link-task-proj", "deep-link-task");
    const taskId = await getTaskId(client, workspaceId, "deep-link-task");

    // Deep link via full page navigation
    await page.goto(`/tasks/${taskId}`);
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // TaskPage component should render (task-title visible, tab bar visible)
    await expect(page.locator("[data-testid='task-title']")).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain(`/tasks/${taskId}`);
    await expect(page.locator('button[role="tab"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test("page refresh preserves current view", async ({ appPage }) => {
    const page = appPage;

    // Navigate to settings via sidebar tab
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

    // Reload
    await page.reload();
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Should still be on settings
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain("/settings");
  });

  test("back/forward navigation works between pages", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create a workspace and navigate to it via URL
    await createWorkspace(client, "back-fwd-proj");
    await navigateToWorkspace(page, "back-fwd-proj");

    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

    // Go back — should be on the workspace page
    await page.goBack();
    await expect(page.getByText("back-fwd-proj").first()).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain("/workspaces/");

    // Go forward — back to settings
    await page.goForward();
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain("/settings");
  });

  test("unknown route redirects to home", async ({ appPage }) => {
    const page = appPage;

    await page.goto("/this-route-does-not-exist");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Should redirect to the dashboard home route.
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("deep link to /tasks/:id/stream loads stream tab", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create workspace and task via WS
    await createWorkspace(client, "deep-stream-proj");
    const workspaceId = await getWorkspaceId(client, "deep-stream-proj");
    await createTask(client, "deep-stream-proj", "deep-stream-task");
    const taskId = await getTaskId(client, workspaceId, "deep-stream-task");

    // Deep link to the stream tab
    await page.goto(`/tasks/${taskId}/stream`);
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // TaskPage renders with stream tab active — scope to main content to avoid matching sidebar tabs
    await expect(page.locator("[data-testid='task-title']")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("tab", { name: "Stream", exact: true })).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });
    expect(page.url()).toContain(`/tasks/${taskId}/stream`);
  });

  test("deep link to /sessions/new without ?env disables Go button", async ({ appPage }) => {
    const page = appPage;

    await page.goto("/sessions/new");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // The Go button should be disabled (no env selected)
    const goButton = page.locator("button", { hasText: "Go" });
    await expect(goButton).toBeDisabled({ timeout: 5_000 });
  });
});
