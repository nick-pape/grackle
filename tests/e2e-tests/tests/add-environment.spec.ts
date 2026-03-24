import { test, expect } from "./fixtures.js";

// WebSocket Handler and Update Environment tests have been migrated to
// packages/server/src/grpc-environment.test.ts as integration tests.

test.describe("Add Environment — UI Form", { tag: ["@environment"] }, () => {
  test.beforeEach(async ({ appPage }) => {
    // Navigate to the Environments tab
    await appPage.locator('[data-testid="sidebar-tab-environments"]').click();
  });

  test("add environment via UI form creates environment in server", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Switch to Environments tab, open form
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.locator('button[title="Add environment"]').click();

    // Fill in form
    await page.getByTestId("env-create-name").fill("ui-test-env");

    // Click Create
    await page.getByTestId("env-create-submit").click();

    // Form should close (back to environment list)
    await expect(page.getByTestId("env-create-panel")).not.toBeVisible({ timeout: 5_000 });

    // Environment should appear in the environment list
    await expect(page.getByText("ui-test-env", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Clean up via RPC
    const listResponse = await client.listEnvironments({});
    const added = listResponse.environments.find((e) => e.displayName === "ui-test-env");
    if (added) {
      await client.removeEnvironment({ id: added.id });
    }
  });
});
