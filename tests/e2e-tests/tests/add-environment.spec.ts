import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor, sendWsMessage } from "./helpers.js";

test.describe("Add Environment — UI Form", () => {
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

        },
      },
      "environment.added",
    );

    expect(response.payload?.environmentId).toBeTruthy();

    // Switch to Environments tab and verify the new environment appears
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
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

        },
      },
      "environment.added",
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
});

test.describe("Update Environment — WebSocket Handler", () => {
  test("update_environment changes displayName", async ({ appPage }) => {
    const page = appPage;

    // First create an environment to update
    const addResponse = await sendWsAndWaitFor(
      page,
      {
        type: "add_environment",
        payload: {
          displayName: "update-name-test",
          adapterType: "local",
          adapterConfig: {},
        },
      },
      "environment.added",
    );
    const environmentId = addResponse.payload?.environmentId as string;
    expect(environmentId).toBeTruthy();

    // Update the name
    await sendWsAndWaitFor(
      page,
      {
        type: "update_environment",
        payload: {
          environmentId,
          displayName: "updated-name",
        },
      },
      "environment.changed",
    );

    // Verify the name changed
    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_environments" },
      "environments",
    );
    const envs = (listResponse.payload?.environments || []) as Array<{ id: string; displayName: string }>;
    const updated = envs.find((e) => e.id === environmentId);
    expect(updated?.displayName).toBe("updated-name");

    // Clean up
    await sendWsMessage(page, {
      type: "remove_environment",
      payload: { environmentId },
    });
  });

  test("update_environment changes adapterConfig", async ({ appPage }) => {
    const page = appPage;

    const addResponse = await sendWsAndWaitFor(
      page,
      {
        type: "add_environment",
        payload: {
          displayName: "update-config-test",
          adapterType: "local",
          adapterConfig: {},
        },
      },
      "environment.added",
    );
    const environmentId = addResponse.payload?.environmentId as string;

    // Update the config
    await sendWsAndWaitFor(
      page,
      {
        type: "update_environment",
        payload: {
          environmentId,
          adapterConfig: { host: "1.2.3.4", port: 9999 },
        },
      },
      "environment.changed",
    );

    // Verify the config changed
    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_environments" },
      "environments",
    );
    const envs = (listResponse.payload?.environments || []) as Array<{
      id: string;
      adapterConfig: string;
    }>;
    const updated = envs.find((e) => e.id === environmentId);
    expect(JSON.parse(updated!.adapterConfig)).toEqual({ host: "1.2.3.4", port: 9999 });

    // Clean up
    await sendWsMessage(page, {
      type: "remove_environment",
      payload: { environmentId },
    });
  });

  test("update_environment rejects empty name", async ({ appPage }) => {
    const page = appPage;

    const addResponse = await sendWsAndWaitFor(
      page,
      {
        type: "add_environment",
        payload: {
          displayName: "empty-name-test",
          adapterType: "local",
        },
      },
      "environment.added",
    );
    const environmentId = addResponse.payload?.environmentId as string;

    const response = await sendWsAndWaitFor(
      page,
      {
        type: "update_environment",
        payload: {
          environmentId,
          displayName: "  ",
        },
      },
      "error",
    );

    expect(response.payload?.message).toContain("Environment name cannot be empty");

    // Clean up
    await sendWsMessage(page, {
      type: "remove_environment",
      payload: { environmentId },
    });
  });

  test("update_environment rejects unknown environment ID", async ({ appPage }) => {
    const page = appPage;

    const response = await sendWsAndWaitFor(
      page,
      {
        type: "update_environment",
        payload: {
          environmentId: "nonexistent-env-id",
          displayName: "should-fail",
        },
      },
      "error",
    );

    expect(response.payload?.message).toContain("Environment not found");
  });
});
