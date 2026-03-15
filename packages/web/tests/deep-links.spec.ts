import { test, expect } from "./fixtures.js";
import { createProject, createTask, getProjectId, getTaskId } from "./helpers.js";

test.describe("Deep linking", () => {
  test("deep link to /settings loads settings page", async ({ appPage }) => {
    const page = appPage;

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
  });

  test("deep link to /projects/:id loads project", async ({ appPage }) => {
    const page = appPage;

    // Create a project first
    await createProject(page, "deep-link-proj");
    const projectId = await getProjectId(page, "deep-link-proj");

    // Navigate away then deep link directly
    await page.goto(`/projects/${projectId}`);
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // The project page should be visible (sidebar shows project name)
    await expect(page.getByText("deep-link-proj").first()).toBeVisible({ timeout: 5_000 });
  });

  test("deep link to /tasks/:id loads task detail", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "deep-link-task-proj");
    await page.getByText("deep-link-task-proj").click();
    await createTask(page, "deep-link-task-proj", "deep-link-task");
    const projectId = await getProjectId(page, "deep-link-task-proj");
    const taskId = await getTaskId(page, projectId, "deep-link-task");

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

    // Navigate to settings
    await page.locator('button[title="Settings"]').click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

    // Reload
    await page.reload();
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Should still be on settings
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain("/settings");
  });

  test("back/forward navigation works between pages", async ({ appPage }) => {
    const page = appPage;

    // Create a project to navigate to
    await createProject(page, "back-fwd-proj");

    // Navigate: home -> project -> settings
    await page.getByText("back-fwd-proj").click();
    await page.waitForTimeout(500);

    await page.locator('button[title="Settings"]').click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

    // Go back — should be on the project page
    await page.goBack();
    await expect(page.getByText("back-fwd-proj").first()).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain("/projects/");

    // Go forward — back to settings
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain("/settings");
  });

  test("unknown route redirects to /", async ({ appPage }) => {
    const page = appPage;

    await page.goto("/this-route-does-not-exist");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Should redirect to root (catch-all <Navigate to="/" replace />)
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("deep link to /tasks/:id/stream loads stream tab", async ({ appPage }) => {
    const page = appPage;

    // Create project and task
    await createProject(page, "deep-stream-proj");
    await page.getByText("deep-stream-proj").click();
    await createTask(page, "deep-stream-proj", "deep-stream-task");
    const projectId = await getProjectId(page, "deep-stream-proj");
    const taskId = await getTaskId(page, projectId, "deep-stream-task");

    // Deep link to the stream tab
    await page.goto(`/tasks/${taskId}/stream`);
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // TaskPage renders with stream tab active
    await expect(page.locator("[data-testid='task-title']")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button[role="tab"][aria-selected="true"]')).toContainText("Stream");
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
