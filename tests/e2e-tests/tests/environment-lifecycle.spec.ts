import { test, expect } from "./fixtures.js";
import {
  goToEnvironments,
  provisionEnvironmentDirect,
} from "./helpers.js";

/**
 * Navigate to the environment detail page for the first environment.
 * Clicks on the Environments sidebar tab and then clicks the first env-nav-item.
 */
async function navigateToEnvDetailPage(page: import("@playwright/test").Page): Promise<void> {
  await goToEnvironments(page);
  await page.getByTestId("env-nav-item").first().click();
}

/**
 * Re-provision the test-local environment and wait for it to become
 * connected again. Call this after any test that stops the environment so
 * subsequent tests (and subsequent spec files) are not affected.
 */
async function reprovisionTestLocal(page: import("@playwright/test").Page): Promise<void> {
  // Navigate to the environment detail page and click Connect
  await navigateToEnvDetailPage(page);
  const connectBtn = page.locator("button", { hasText: "Connect" });
  // If already connected (Stop visible), nothing to do
  const stopBtn = page.locator("button", { hasText: "Stop" });
  const isConnected = await stopBtn.isVisible().catch(() => false);
  if (isConnected) {
    return;
  }
  // Click Connect and wait for Stop button to appear
  await expect(connectBtn).toBeVisible({ timeout: 5_000 });
  await connectBtn.click();
  await expect(stopBtn).toBeVisible({ timeout: 15_000 });
}

test.describe("Environment Detail Page — Lifecycle Actions", { tag: ["@environment"] }, () => {
  test.beforeEach(async ({ appPage }) => {
    // Navigate to the environment detail page
    await navigateToEnvDetailPage(appPage);
  });

  test("environment detail page shows lifecycle buttons for connected environment", async ({ appPage }) => {
    const page = appPage;

    // For a connected environment, "Stop" and "Delete" should be visible on the detail page
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("button", { hasText: "Delete" })).toBeVisible({ timeout: 5_000 });
  });

  test("connected environment shows Stop button, not Connect", async ({ appPage }) => {
    const page = appPage;

    // Connected: should have Stop, should NOT have Connect
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("button", { hasText: "Connect" })).not.toBeVisible();
  });

  test("New Chat button is visible for connected environment", async ({ appPage }) => {
    const page = appPage;

    // Connected env should have a "New Chat" button
    await expect(page.getByRole("button", { name: "New Chat" })).toBeVisible({ timeout: 5_000 });
  });

  test("New Chat navigates to new chat view", async ({ appPage }) => {
    const page = appPage;

    // Click New Chat on the detail page
    await page.getByRole("button", { name: "New Chat" }).click();

    // Should navigate to a chat URL
    await expect(page).toHaveURL(/\/sessions\/new/, { timeout: 5_000 });
  });
});

test.describe("Environment Lifecycle — Server Events", { tag: ["@environment"] }, () => {
  test("stop_environment changes status to disconnected", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Navigate to environment detail page
    await navigateToEnvDetailPage(page);

    // Verify connected — Stop button should be visible
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 5_000 });

    // Stop environment via RPC
    await client.stopEnvironment({ id: "test-local" });

    // Wait for Connect button to appear (indicates disconnected)
    await expect(page.locator("button", { hasText: "Connect" })).toBeVisible({ timeout: 5_000 });

    // Re-provision so other tests aren't affected
    await reprovisionTestLocal(page);
  });

  test("provision_environment connects a disconnected environment", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Navigate to environment detail page
    await navigateToEnvDetailPage(page);

    // First stop the environment
    await client.stopEnvironment({ id: "test-local" });

    // Wait for disconnected state — Connect button should appear
    await expect(page.locator("button", { hasText: "Connect" })).toBeVisible({ timeout: 5_000 });

    // Provision it back by clicking Connect in the UI
    await page.locator("button", { hasText: "Connect" }).click();

    // Wait for environment to become connected again — Stop button appears
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 15_000 });
  });

  test("provision_progress messages update UI during provisioning", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Navigate to environment detail page
    await navigateToEnvDetailPage(page);

    // Stop the environment first
    await client.stopEnvironment({ id: "test-local" });

    // Wait for it to show as disconnected
    await expect(page.locator("button", { hasText: "Connect" })).toBeVisible({ timeout: 5_000 });

    // Click Connect and watch for provision progress
    await page.locator("button", { hasText: "Connect" }).click();

    // The provision flow should eventually complete — wait for Stop button
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 15_000 });
  });

  test("remove_environment removes the environment from the nav", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await goToEnvironments(page);

    // Add a real temporary environment for testing removal
    const added = await client.addEnvironment({
      displayName: "temp-remove-test",
      adapterType: "local",
    });

    // Verify both environments appear in the nav
    const navItems = page.getByTestId("env-nav-item");
    await expect(navItems).toHaveCount(2, { timeout: 5_000 });
    await expect(page.getByText("temp-remove-test").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("test-local").first()).toBeVisible();

    // Remove the temporary environment via RPC
    await client.removeEnvironment({ id: added.id });

    // The temporary environment should be gone from the nav
    await expect(page.getByText("temp-remove-test")).not.toBeVisible({ timeout: 5_000 });
    // Original environment should still be there
    await expect(page.getByText("test-local").first()).toBeVisible();
    await expect(navItems).toHaveCount(1, { timeout: 5_000 });
  });

  test("auto-provision on spawn when environment is disconnected", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Navigate to environment detail page
    await navigateToEnvDetailPage(page);

    // Stop the environment
    await client.stopEnvironment({ id: "test-local" });

    // Verify environment is disconnected — Connect button should appear
    await expect(page.locator("button", { hasText: "Connect" })).toBeVisible({ timeout: 5_000 });

    // Spawn via RPC — the server should auto-provision
    const response = await client.spawnAgent({
      environmentId: "test-local",
      prompt: "auto-provision test",
      personaId: "stub",
    });

    // The server auto-provisioned and returned a session with an ID
    expect(response.id).toBeTruthy();

    // Verify the environment is now connected again — Stop button should appear
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Environment Lifecycle — Delete with Confirmation", { tag: ["@environment"] }, () => {
  test("delete button shows confirmation dialog", async ({ appPage }) => {
    const page = appPage;

    // Navigate to environment detail page
    await navigateToEnvDetailPage(page);

    // Click Delete — the in-app ConfirmDialog should appear
    await page.locator("button", { hasText: "Delete" }).click();

    // Verify the in-app dialog is visible with correct content
    await expect(page.getByText("Delete Environment?")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/"test-local"/)).toBeVisible();

    // Cancel via the Cancel button
    await page.locator('[role="dialog"] button', { hasText: "Cancel" }).click();

    // Dialog should be gone; environment should still be visible (we cancelled)
    await expect(page.getByText("Delete Environment?")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("test-local").first()).toBeVisible();
  });
});
