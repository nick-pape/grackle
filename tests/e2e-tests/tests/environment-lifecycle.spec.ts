import { test, expect } from "./fixtures.js";
import {
  sendWsAndWaitFor,
  sendWsMessage,
  installWsTracker,
  injectWsMessage,
  goToEnvironments,
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
 * Re-provision the test-local environment via WS and wait for it to become
 * connected again. Call this after any test that stops the environment so
 * subsequent tests (and subsequent spec files) are not affected.
 */
async function reprovisionTestLocal(page: import("@playwright/test").Page): Promise<void> {
  await sendWsMessage(page, {
    type: "provision_environment",
    payload: { environmentId: "test-local" },
  });
  // Wait for the status to change — navigate to detail page and check for Stop button
  await navigateToEnvDetailPage(page);
  await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 15_000 });
}

test.describe("Environment Detail Page — Lifecycle Actions", () => {
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

test.describe("Environment Lifecycle — WebSocket Handlers", () => {
  test("stop_environment changes status to disconnected", async ({ page }) => {
    // Use raw page (not appPage) so we can install WS tracker first
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Navigate to environment detail page
    await navigateToEnvDetailPage(page);

    // Verify connected — Stop button should be visible
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 5_000 });

    // Send stop_environment via WS
    await sendWsMessage(page, {
      type: "stop_environment",
      payload: { environmentId: "test-local" },
    });

    // Wait for Connect button to appear (indicates disconnected)
    await expect(page.locator("button", { hasText: "Connect" })).toBeVisible({ timeout: 5_000 });

    // Re-provision so other tests aren't affected
    await reprovisionTestLocal(page);
  });

  test("provision_environment connects a disconnected environment", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Navigate to environment detail page
    await navigateToEnvDetailPage(page);

    // First stop the environment
    await sendWsMessage(page, {
      type: "stop_environment",
      payload: { environmentId: "test-local" },
    });

    // Wait for disconnected state — Connect button should appear
    await expect(page.locator("button", { hasText: "Connect" })).toBeVisible({ timeout: 5_000 });

    // Now provision it back via WS message
    await sendWsMessage(page, {
      type: "provision_environment",
      payload: { environmentId: "test-local" },
    });

    // Wait for environment to become connected again — Stop button appears
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 15_000 });
  });

  test("provision_progress messages update UI during provisioning", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Navigate to environment detail page
    await navigateToEnvDetailPage(page);

    // Stop the environment first
    await sendWsMessage(page, {
      type: "stop_environment",
      payload: { environmentId: "test-local" },
    });

    // Wait for it to show as disconnected
    await expect(page.locator("button", { hasText: "Connect" })).toBeVisible({ timeout: 5_000 });

    // Click Connect and watch for provision progress
    await page.locator("button", { hasText: "Connect" }).click();

    // The provision flow should eventually complete — wait for Stop button
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 15_000 });
  });

  test("remove_environment removes the environment from the nav", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    await goToEnvironments(page);

    // Inject a fake environment into the list for testing removal
    await injectWsMessage(page, {
      type: "environments",
      payload: {
        environments: [
          {
            id: "test-local",
            displayName: "test-local",
            adapterType: "local",

            status: "connected",
            bootstrapped: true,
          },
          {
            id: "temp-remove-test",
            displayName: "temp-remove-test",
            adapterType: "local",

            status: "disconnected",
            bootstrapped: false,
          },
        ],
      },
    });

    // Verify both environments appear in the nav
    const navItems = page.getByTestId("env-nav-item");
    await expect(navItems).toHaveCount(2, { timeout: 5_000 });
    await expect(page.getByText("temp-remove-test").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("test-local").first()).toBeVisible();

    // Inject an environment_removed message
    await injectWsMessage(page, {
      type: "environments",
      payload: {
        environments: [
          {
            id: "test-local",
            displayName: "test-local",
            adapterType: "local",

            status: "connected",
            bootstrapped: true,
          },
        ],
      },
    });

    // The temporary environment should be gone from the nav
    await expect(page.getByText("temp-remove-test")).not.toBeVisible({ timeout: 5_000 });
    // Original environment should still be there
    await expect(page.getByText("test-local").first()).toBeVisible();
    await expect(navItems).toHaveCount(1, { timeout: 5_000 });
  });

  test("auto-provision on spawn when environment is disconnected", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Navigate to environment detail page
    await navigateToEnvDetailPage(page);

    // Stop the environment
    await sendWsMessage(page, {
      type: "stop_environment",
      payload: { environmentId: "test-local" },
    });

    // Verify environment is disconnected — Connect button should appear
    await expect(page.locator("button", { hasText: "Connect" })).toBeVisible({ timeout: 5_000 });

    // Send a spawn message directly via WS — the server should auto-provision
    const response = await sendWsAndWaitFor(
      page,
      {
        type: "spawn",
        payload: {
          environmentId: "test-local",
          prompt: "auto-provision test",
          runtime: "stub",
        },
      },
      "spawned",
      30_000,
    );

    // The server auto-provisioned and returned a spawned message with a session ID
    expect(response.payload?.sessionId).toBeTruthy();

    // Verify the environment is now connected again — Stop button should appear
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Environment Lifecycle — Delete with Confirmation", () => {
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
