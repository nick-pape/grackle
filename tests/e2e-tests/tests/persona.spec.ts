import { test, expect } from "./fixtures.js";
import { WORKER_MCP_TOOLS, DEFAULT_SCOPED_MCP_TOOLS } from "@grackle-ai/common";

// Pure protocol tests (create, delete, update, validation) have been migrated to
// packages/server/src/grpc-persona.test.ts as integration tests.

test.describe("Persona Management — UI", { tag: ["@persona"] }, () => {
  test("persona management view shows created personas", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;

    // Create a persona
    await client.createPersona({
      name: "Security Reviewer",
      description: "Reviews code for vulnerabilities",
      systemPrompt: "You review code for security issues.",
      runtime: "stub",
      model: "opus",
    });

    // Navigate to persona management view via the personas button in status bar
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Personas" }).click();

    // Verify the persona management view is shown with our persona
    await expect(page.getByRole("heading", { name: "Personas" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Security Reviewer")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByText("Reviews code for vulnerabilities"),
    ).toBeVisible();
  });

  test("created persona appears in management view with all details", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;

    await client.createPersona({
      name: "Detailed Persona",
      description: "A persona with full details",
      systemPrompt: "You are detailed.",
      runtime: "stub",
      model: "opus",
    });

    // Navigate to persona management view
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Personas" }).click();
    await expect(page.getByRole("heading", { name: "Personas" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Detailed Persona")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByText("A persona with full details"),
    ).toBeVisible();
  });

  test("delete persona removes it from management view", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;

    // Create a persona
    await client.createPersona({
      name: "Soon Deleted",
      systemPrompt: "Will be deleted",
    });

    // Navigate to management view and verify it appears
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Personas" }).click();
    await expect(page.getByRole("heading", { name: "Personas" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Soon Deleted")).toBeVisible({
      timeout: 5_000,
    });

    // Delete via RPC
    const personas = await client.listPersonas({});
    const toDelete = personas.personas.find((p) => p.name === "Soon Deleted");
    expect(toDelete).toBeDefined();

    await client.deletePersona({ id: toDelete!.id });

    // The management view should no longer show the persona
    await expect(page.getByText("Soon Deleted")).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test("persona with custom MCP tools shows tools in detail view", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;

    // Create a persona with the worker MCP tools preset via gRPC
    const persona = await client.createPersona({
      name: "Worker Agent",
      description: "Has restricted MCP tools",
      systemPrompt: "You are a restricted worker.",
      runtime: "stub",
      model: "sonnet",
      allowedMcpTools: [...WORKER_MCP_TOOLS],
    });

    // Navigate to the persona detail page
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Personas" }).click();
    await expect(page.getByText("Worker Agent")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId(`persona-card-${persona.id}`).click();
    await page.waitForURL(`**/settings/personas/${persona.id}`, { timeout: 5_000 });

    // Verify the MCP tool selector is visible with the correct count
    const selector = page.getByTestId("mcp-tool-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
    await expect(selector).toContainText(`${WORKER_MCP_TOOLS.length} of`);

    // Verify specific worker tools are checked
    await expect(page.getByTestId("tool-finding_post")).toBeChecked();
    await expect(page.getByTestId("tool-finding_list")).toBeChecked();
    await expect(page.getByTestId("tool-workpad_read")).toBeChecked();

    // Verify non-worker tools are NOT checked
    await expect(page.getByTestId("tool-task_create")).not.toBeChecked();
    await expect(page.getByTestId("tool-env_list")).not.toBeChecked();
  });

  test("persona without MCP tools shows default message", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;

    // Create a persona without explicit MCP tools (uses default)
    const persona = await client.createPersona({
      name: "Unscoped Tester",
      systemPrompt: "You use default tools.",
      runtime: "stub",
      model: "sonnet",
    });

    // Navigate to persona detail
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Personas" }).click();
    await expect(page.getByText("Unscoped Tester")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId(`persona-card-${persona.id}`).click();
    await page.waitForURL(`**/settings/personas/${persona.id}`, { timeout: 5_000 });

    // Verify it shows "Using default" message
    const selector = page.getByTestId("mcp-tool-selector");
    await expect(selector).toBeVisible({ timeout: 5_000 });
    await expect(selector).toContainText(`Using default (${DEFAULT_SCOPED_MCP_TOOLS.length} tools)`);
  });

  test("clicking preset updates MCP tools selection", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;

    // Create a persona with no MCP tools
    const persona = await client.createPersona({
      name: "Preset Test Agent",
      systemPrompt: "Testing presets.",
      runtime: "stub",
      model: "sonnet",
    });

    // Navigate to persona detail
    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Personas" }).click();
    await expect(page.getByText("Preset Test Agent")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId(`persona-card-${persona.id}`).click();
    await page.waitForURL(`**/settings/personas/${persona.id}`, { timeout: 5_000 });

    // Click "Worker" preset
    await page.getByTestId("preset-worker").click();

    // Wait for the selection count to update
    const selector = page.getByTestId("mcp-tool-selector");
    await expect(selector).toContainText(`${WORKER_MCP_TOOLS.length} of`, { timeout: 5_000 });

    // Verify the change persisted by reloading the page
    await page.reload();
    await expect(page.getByTestId("mcp-tool-selector")).toContainText(`${WORKER_MCP_TOOLS.length} of`, { timeout: 10_000 });
  });

  test("personas tab shows breadcrumbs with Home > Settings", async ({ appPage }) => {
    const page = appPage;

    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Personas" }).click();

    const breadcrumbs = page.getByTestId("breadcrumbs");
    await expect(breadcrumbs).toBeVisible({ timeout: 5_000 });
    await expect(breadcrumbs).toContainText("Home");
    await expect(breadcrumbs).toContainText("Settings");
  });

  test("persona detail routes support create, edit, and delete", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;

    await page.locator('[data-testid="sidebar-tab-settings"]').click();
    await page.getByRole("tab", { name: "Personas" }).click();
    await page.getByTestId("persona-new-button").click();

    await page.waitForURL("**/settings/personas/new", { timeout: 5_000 });
    await expect(page.getByRole("tab", { name: "Personas", selected: true })).toBeVisible();

    await page.getByTestId("persona-detail-name").fill("Route Created Persona");
    await page.getByTestId("persona-detail-description").fill("Created from the persona detail page");
    await page.getByTestId("persona-detail-prompt").fill("You help validate persona detail routes.");
    await page.getByTestId("persona-detail-save").click();

    // Wait for navigation to the new persona's detail page before querying the server
    await page.waitForURL(/\/settings\/personas\/[^/]+$/, { timeout: 5_000 });

    // Poll listPersonas until the created persona appears (avoids racing the create RPC)
    let createdPersona: { id: string; name: string } | undefined;
    await expect.poll(async () => {
      const personasAfterCreate = await client.listPersonas({});
      createdPersona = personasAfterCreate.personas.find((persona) => persona.name === "Route Created Persona");
      return createdPersona;
    }, { timeout: 5_000 }).toBeDefined();

    await page.waitForURL(`**/settings/personas/${createdPersona!.id}`, { timeout: 5_000 });
    await expect(page.getByRole("heading", { name: "Edit Persona" })).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("persona-detail-cancel").click();
    await expect(page).toHaveURL(/\/settings\/personas$/, { timeout: 5_000 });
    await expect(page.getByTestId(`persona-card-${createdPersona!.id}`)).toContainText("Route Created Persona", { timeout: 5_000 });

    await page.getByTestId(`persona-card-${createdPersona!.id}`).click();
    await page.waitForURL(`**/settings/personas/${createdPersona!.id}`, { timeout: 5_000 });
    await expect(page.getByRole("tab", { name: "Personas", selected: true })).toBeVisible();

    await page.getByTestId("persona-detail-name-button").click();
    await page.getByTestId("persona-detail-name-input").fill("Route Updated Persona");
    await page.getByTestId("persona-detail-name-input").press("Enter");

    await page.getByTestId("persona-detail-description-button").click();
    await page.getByTestId("persona-detail-description-input").fill("Updated from the persona detail page");
    await page.getByTestId("persona-detail-description-input").press("Enter");

    await page.getByTestId("persona-detail-cancel").click();

    // Poll listPersonas until the update is reflected (avoids racing the update RPC)
    let updatedPersona: { id: string; name: string } | undefined;
    await expect.poll(async () => {
      const personasAfterUpdate = await client.listPersonas({});
      updatedPersona = personasAfterUpdate.personas.find((persona) => persona.name === "Route Updated Persona");
      return updatedPersona;
    }, { timeout: 5_000 }).toBeDefined();

    await expect(page).toHaveURL(/\/settings\/personas$/, { timeout: 5_000 });
    await expect(page.getByTestId(`persona-card-${updatedPersona!.id}`)).toContainText("Route Updated Persona", { timeout: 5_000 });

    await page.getByTestId(`persona-card-${updatedPersona!.id}`).click();
    await page.waitForURL(`**/settings/personas/${updatedPersona!.id}`, { timeout: 5_000 });
    await page.getByTestId("persona-detail-delete").click();

    const dialog = page.getByRole("dialog", { name: "Delete Persona?" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(page).toHaveURL(/\/settings\/personas$/, { timeout: 5_000 });
    await expect(page.getByTestId(`persona-card-${updatedPersona!.id}`)).toHaveCount(0);
  });
});
