import { test, expect } from "./fixtures.js";
import { createWorkspace, sendWsAndWaitFor } from "./helpers.js";

/** Archive all existing workspaces so we start from a clean slate. */
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
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
  }
}

test.describe("Dashboard", () => {
  test("shows onboarding CTA when no workspaces exist", async ({ appPage }) => {
    const page = appPage;
    await archiveAllWorkspaces(page);

    // Welcome CTA should be visible, dashboard should not
    await expect(page.locator('[data-testid="welcome-cta"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="dashboard"]')).not.toBeVisible();
  });

  test("shows dashboard when workspaces exist", async ({ appPage }) => {
    const page = appPage;

    // Create a workspace so dashboard appears
    await createWorkspace(page, "dashboard-test");
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Dashboard should be visible
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 5_000 });

    // KPI strip rendered
    await expect(page.locator('[data-testid="dashboard-kpi-strip"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-active-sessions"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-blocked-tasks"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-attention-tasks"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-unhealthy-envs"]')).toBeVisible();
  });

  test("dashboard sections render correctly", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "sections-test");
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 5_000 });

    // All four sections visible
    await expect(page.locator('[data-testid="dashboard-active-sessions"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-needs-attention"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-env-health"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-workspace-snapshot"]')).toBeVisible();

    // Environment health should show at least one environment row
    await expect(
      page.locator('[data-testid="dashboard-env-health"] [data-testid="env-row"]').first(),
    ).toBeVisible();

    // Workspace snapshot should show the workspace we created
    await expect(page.locator('[data-testid="workspace-row"]').first()).toBeVisible();
  });

  test("Home sidebar item navigates to dashboard", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "home-nav-test");

    // Navigate away from root
    await page.locator('[data-testid="workspace-row"]').first().click();

    // Now click Home in sidebar
    await page.locator('[data-testid="sidebar-home"]').click();

    // Should be at root and dashboard visible
    await expect(page).toHaveURL("/");
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 5_000 });
  });

  test("workspace card click navigates to workspace", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "click-nav-test");
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 5_000 });

    // Click first workspace row in the snapshot
    await page.locator('[data-testid="workspace-row"]').first().click();

    // Should navigate to workspace page
    await expect(page).toHaveURL(/\/workspaces\//);
  });
});
