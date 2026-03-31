import { test, expect } from "./fixtures.js";
import { createWorkspace } from "./helpers.js";
import type { GrackleClient } from "./rpc-client.js";

/** Archive all existing workspaces so we start from a clean slate. */
async function archiveAllWorkspaces(client: GrackleClient): Promise<void> {
  const response = await client.core.listWorkspaces({});
  for (const workspace of response.workspaces) {
    await client.core.archiveWorkspace({ id: workspace.id });
  }
}

test.describe("Dashboard", { tag: ["@webui", "@smoke"] }, () => {
  test("shows onboarding CTA when no workspaces exist", async ({ appPage, grackle: { client } }) => {
    const page = appPage;
    await archiveAllWorkspaces(client);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Welcome CTA should be visible, dashboard should not
    await expect(page.locator('[data-testid="welcome-cta"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="dashboard"]')).not.toBeVisible();
  });

  test("shows dashboard when workspaces exist", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create a workspace so dashboard appears
    await createWorkspace(client, "dashboard-test");
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

  test("dashboard sections render correctly", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await createWorkspace(client, "sections-test");
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
      page.locator('[data-testid="dashboard-env-health"] [data-testid="dashboard-env-row"]').first(),
    ).toBeVisible();

    // Workspace snapshot should show the workspace we created
    await expect(page.locator('[data-testid="workspace-row"]').first()).toBeVisible();
  });

  test("Dashboard sidebar tab navigates to dashboard", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await createWorkspace(client, "home-nav-test");

    // Navigate away from root
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="workspace-row"]').first().click();

    // Now click the Dashboard tab in the sidebar
    await page.locator('[data-testid="sidebar-tab-dashboard"]').click();

    // Should be at root and dashboard visible
    await expect(page).toHaveURL("/");
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 5_000 });
  });

  test("workspace card click navigates to workspace", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await createWorkspace(client, "click-nav-test");
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
