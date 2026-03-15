import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor, sendWsMessage } from "./helpers.js";

test.describe("Add Environment — UI Form", () => {
  test.beforeEach(async ({ appPage }) => {
    // Environments are now in Settings — navigate there via the gear button
    await appPage.locator('button[title="Settings"]').click();
  });

  test("clicking + opens new environment form in UnifiedBar", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    // UnifiedBar should show the "new env" badge and form elements
    await expect(page.getByText("new env", { exact: true })).toBeVisible();
    await expect(page.locator('input[placeholder="Environment name..."]')).toBeVisible();
    await expect(page.locator("button", { hasText: "Add" })).toBeVisible();
  });

  test("adapter type dropdown defaults to local", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    // The first select in the form is the adapter type selector
    const selects = page.locator("select");
    // Adapter type select should default to "local"
    await expect(selects.first()).toHaveValue("local");
  });

  test("Add button is disabled when name is empty", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    // Wait for the new env form to appear after navigation
    await expect(page.getByText("new env", { exact: true })).toBeVisible();
    const addButton = page.locator("button", { hasText: /^Add$/ });
    await expect(addButton).toBeDisabled();
  });

  test("Add button is enabled when name is filled for local adapter", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    await page.locator('input[placeholder="Environment name..."]').fill("my-local");
    // Wait for the new env form to appear after navigation
    await expect(page.getByText("new env", { exact: true })).toBeVisible();
    const addButton = page.locator("button", { hasText: /^Add$/ });
    await expect(addButton).toBeEnabled();
  });

  test("SSH adapter requires host field", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    // Select SSH adapter
    const adapterSelect = page.locator("select").first();
    await adapterSelect.selectOption("ssh");

    // Fill name but leave host empty
    await page.locator('input[placeholder="Environment name..."]').fill("my-ssh");

    // Wait for the new env form to appear after navigation
    await expect(page.getByText("new env", { exact: true })).toBeVisible();
    const addButton = page.locator("button", { hasText: /^Add$/ });
    await expect(addButton).toBeDisabled();

    // Fill host — now it should be enabled
    await page.locator('input[placeholder="Host (required)..."]').fill("192.168.1.10");
    await expect(addButton).toBeEnabled();
  });

  test("Add button is disabled when port is out of range", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    // Fill a valid name so that only port invalidity blocks the button
    await page.locator('input[placeholder="Environment name..."]').fill("port-test");

    const portInput = page.locator('input[placeholder="Port (optional)..."]');
    // Wait for the new env form to appear after navigation
    await expect(page.getByText("new env", { exact: true })).toBeVisible();
    const addButton = page.locator("button", { hasText: /^Add$/ });

    // Out-of-range low value
    await portInput.fill("0");
    await expect(addButton).toBeDisabled();

    // Out-of-range high value
    await portInput.fill("99999");
    await expect(addButton).toBeDisabled();

    // Valid boundary values should re-enable the button
    await portInput.fill("1");
    await expect(addButton).toBeEnabled();

    await portInput.fill("65535");
    await expect(addButton).toBeEnabled();

    // Clearing port (optional) keeps the button enabled
    await portInput.fill("");
    await expect(addButton).toBeEnabled();
  });

  test("switching adapter type shows correct conditional fields", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Add environment"]').click();

    const adapterSelect = page.locator("select").first();

    // Local shows host and port (optional)
    await expect(page.locator('input[placeholder="Host (optional)..."]')).toBeVisible();
    await expect(page.locator('input[placeholder="Port (optional)..."]')).toBeVisible();

    // Switch to SSH — shows host (required), user, port, identity file
    await adapterSelect.selectOption("ssh");
    await expect(page.locator('input[placeholder="Host (required)..."]')).toBeVisible();
    await expect(page.locator('input[placeholder="User (optional)..."]')).toBeVisible();
    await expect(page.locator('input[placeholder="SSH port (optional)..."]')).toBeVisible();
    await expect(page.locator('input[placeholder="Identity file (optional)..."]')).toBeVisible();

    // Switch to Docker — shows image and repo
    await adapterSelect.selectOption("docker");
    await expect(page.locator('input[placeholder="Image (optional)..."]')).toBeVisible();
    await expect(page.locator('input[placeholder="Repo (optional)..."]')).toBeVisible();
  });
});

test.describe("Add Environment — WebSocket Handler", () => {
  test("add_environment creates environment visible in list", async ({ appPage }) => {
    const page = appPage;

    // Send add_environment via WS and wait for the broadcast
    const response = await sendWsAndWaitFor(
      page,
      {
        type: "add_environment",
        payload: {
          displayName: "ws-test-env",
          adapterType: "local",
          adapterConfig: {},
          defaultRuntime: "stub",
        },
      },
      "environment_added",
    );

    expect(response.payload?.environmentId).toBeTruthy();

    // Switch to Environments (in Settings) and verify the new environment appears
    await page.locator('button[title="Settings"]').click();
    await expect(page.getByText("ws-test-env", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Clean up: remove the environment
    await sendWsMessage(page, {
      type: "remove_environment",
      payload: { environmentId: response.payload?.environmentId as string },
    });
  });

  test("add_environment returns error when displayName is missing", async ({ appPage }) => {
    const page = appPage;

    const response = await sendWsAndWaitFor(
      page,
      {
        type: "add_environment",
        payload: {
          adapterType: "local",
        },
      },
      "error",
    );

    expect(response.payload?.message).toContain("displayName and adapterType required");
  });

  test("add_environment returns error when adapterType is missing", async ({ appPage }) => {
    const page = appPage;

    const response = await sendWsAndWaitFor(
      page,
      {
        type: "add_environment",
        payload: {
          displayName: "missing-adapter",
        },
      },
      "error",
    );

    expect(response.payload?.message).toContain("displayName and adapterType required");
  });

  test("add_environment accepts pre-serialized adapterConfig string without double-encoding", async ({ appPage }) => {
    const page = appPage;

    // Send adapterConfig as an already-serialized JSON string
    const response = await sendWsAndWaitFor(
      page,
      {
        type: "add_environment",
        payload: {
          displayName: "ws-string-config-env",
          adapterType: "local",
          adapterConfig: '{"host":"localhost","port":1234}',
          defaultRuntime: "stub",
        },
      },
      "environment_added",
    );

    const environmentId = response.payload?.environmentId as string;
    expect(environmentId).toBeTruthy();

    // Fetch the environment list and verify the config was stored as-is (not double-encoded)
    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_environments" },
      "environments",
    );
    const envs = (listResponse.payload?.environments || []) as Array<{
      id: string;
      displayName: string;
      adapterConfig: string;
    }>;
    const added = envs.find((e) => e.displayName === "ws-string-config-env");
    expect(added).toBeTruthy();
    // adapterConfig must equal the original string, not a double-encoded version
    expect(added!.adapterConfig).toBe('{"host":"localhost","port":1234}');

    // Clean up
    await sendWsMessage(page, {
      type: "remove_environment",
      payload: { environmentId },
    });
  });

  test("add_environment rejects adapterConfig of invalid type", async ({ appPage }) => {
    const page = appPage;

    const response = await sendWsAndWaitFor(
      page,
      {
        type: "add_environment",
        payload: {
          displayName: "ws-bad-config-env",
          adapterType: "local",
          adapterConfig: 42,
        },
      },
      "error",
    );

    expect(response.payload?.message).toContain("adapterConfig must be an object or JSON string");
  });

  test("add_environment rejects adapterConfig string that is not valid JSON", async ({ appPage }) => {
    const page = appPage;

    const response = await sendWsAndWaitFor(
      page,
      {
        type: "add_environment",
        payload: {
          displayName: "ws-invalid-json-env",
          adapterType: "local",
          adapterConfig: "not-valid-json",
        },
      },
      "error",
    );

    expect(response.payload?.message).toContain("adapterConfig string is not valid JSON");
  });

  test("add environment via UI form creates environment in server", async ({ appPage }) => {
    const page = appPage;

    // Switch to Environments (in Settings), open form
    await page.locator('button[title="Settings"]').click();
    await page.locator('button[title="Add environment"]').click();

    // Fill in form
    await page.locator('input[placeholder="Environment name..."]').fill("ui-test-env");

    // Click Add
    await page.locator("button", { hasText: /^Add$/ }).click();

    // Wait for navigation back to settings to complete
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 5_000 });

    // Form should close (back to settings mode)
    await expect(page.locator("text=new env")).not.toBeVisible({ timeout: 5_000 });

    // Environment should appear in the Settings panel environment list
    await expect(page.getByText("ui-test-env", { exact: true })).toBeVisible({ timeout: 5_000 });

    // Clean up via WS
    // First find the environment ID from list_environments
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
