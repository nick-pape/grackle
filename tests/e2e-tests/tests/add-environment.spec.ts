import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor, sendWsMessage } from "./helpers.js";

// WebSocket Handler and Update Environment tests have been migrated to
// packages/server/src/grpc-environment.test.ts as integration tests.

test.describe("Add Environment — UI Form", { tag: ["@environment"] }, () => {
  test.beforeEach(async ({ appPage }) => {
    // Navigate to the Environments tab
    await appPage.locator('[data-testid="sidebar-tab-environments"]').click();
  });

  test("clicking + opens new environment form in panel", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    // Panel should show the "new environment" badge and form elements
    await expect(page.getByTestId("env-create-panel")).toBeVisible();
    await expect(page.getByTestId("env-create-name")).toBeVisible();
    await expect(page.getByTestId("env-create-submit")).toBeVisible();
  });

  test("adapter type dropdown defaults to local", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    // Adapter type select should default to "local"
    await expect(page.getByTestId("env-create-adapter")).toHaveValue("local");
  });

  test("Create button is disabled when name is empty", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    // Wait for the panel to appear
    await expect(page.getByTestId("env-create-panel")).toBeVisible();
    const createButton = page.getByTestId("env-create-submit");
    await expect(createButton).toBeDisabled();
  });

  test("Create button is enabled when name is filled for local adapter", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    await page.getByTestId("env-create-name").fill("my-local");
    await expect(page.getByTestId("env-create-panel")).toBeVisible();
    const createButton = page.getByTestId("env-create-submit");
    await expect(createButton).toBeEnabled();
  });

  test("SSH adapter requires host field", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    // Select SSH adapter
    await page.getByTestId("env-create-adapter").selectOption("ssh");

    // Fill name but leave host empty
    await page.getByTestId("env-create-name").fill("my-ssh");

    await expect(page.getByTestId("env-create-panel")).toBeVisible();
    const createButton = page.getByTestId("env-create-submit");
    await expect(createButton).toBeDisabled();

    // Fill host — now it should be enabled
    await page.getByTestId("env-create-host").fill("192.168.1.10");
    await expect(createButton).toBeEnabled();
  });

  test("Create button is disabled when port is out of range", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    // Fill a valid name so that only port invalidity blocks the button
    await page.getByTestId("env-create-name").fill("port-test");

    const portInput = page.getByTestId("env-create-port");
    await expect(page.getByTestId("env-create-panel")).toBeVisible();
    const createButton = page.getByTestId("env-create-submit");

    // Out-of-range low value
    await portInput.fill("0");
    await expect(createButton).toBeDisabled();

    // Out-of-range high value
    await portInput.fill("99999");
    await expect(createButton).toBeDisabled();

    // Valid boundary values should re-enable the button
    await portInput.fill("1");
    await expect(createButton).toBeEnabled();

    await portInput.fill("65535");
    await expect(createButton).toBeEnabled();

    // Clearing port (optional) keeps the button enabled
    await portInput.fill("");
    await expect(createButton).toBeEnabled();
  });

  test("switching adapter type shows correct conditional fields", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    const adapterSelect = page.getByTestId("env-create-adapter");

    // Local shows host and port (optional)
    await expect(page.getByTestId("env-create-host")).toBeVisible();
    await expect(page.getByTestId("env-create-port")).toBeVisible();

    // Switch to SSH — shows host (required), user, port, identity file
    await adapterSelect.selectOption("ssh");
    await expect(page.getByTestId("env-create-host")).toBeVisible();
    await expect(page.getByTestId("env-create-user")).toBeVisible();
    await expect(page.getByTestId("env-create-port")).toBeVisible();
    await expect(page.getByTestId("env-create-identity")).toBeVisible();

    // Switch to Docker — shows image and repo
    await adapterSelect.selectOption("docker");
    await expect(page.getByTestId("env-create-image")).toBeVisible();
    await expect(page.getByTestId("env-create-repo")).toBeVisible();
  });

  test("add environment via UI form creates environment in server", async ({ appPage }) => {
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

    // Clean up via WS
    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_environments" },
      "environments",
    );
    const envs = (listResponse.payload?.environments || []) as Array<{ id: string; displayName: string }>;
    const added = envs.find((e) => e.displayName === "ui-test-env");
    if (added) {
      await sendWsMessage(page, {
        type: "remove_environment",
        payload: { environmentId: added.id },
      });
    }
  });
});

