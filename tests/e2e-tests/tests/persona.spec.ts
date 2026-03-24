import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor } from "./helpers.js";

/**
 * Helper: create a persona via WebSocket and wait for the server acknowledgment.
 * Returns the full WS response payload.
 */
async function createPersonaViaWs(
  page: import("@playwright/test").Page,
  fields: {
    name: string;
    description?: string;
    systemPrompt: string;
    runtime?: string;
    model?: string;
    maxTurns?: number;
  },
): Promise<Record<string, unknown>> {
  return sendWsAndWaitFor(
    page,
    {
      type: "create_persona",
      payload: {
        name: fields.name,
        description: fields.description ?? "",
        systemPrompt: fields.systemPrompt,
        runtime: fields.runtime ?? "stub",
        model: fields.model ?? "",
        maxTurns: fields.maxTurns ?? 0,
      },
    },
    "persona.created",
  );
}

/**
 * Helper: list all personas via WebSocket and return the array.
 */
async function listPersonasViaWs(
  page: import("@playwright/test").Page,
): Promise<Array<{ id: string; name: string; runtime: string; description: string; systemPrompt: string; model: string; maxTurns: number }>> {
  const response = await sendWsAndWaitFor(
    page,
    { type: "list_personas" },
    "personas",
  );
  return (response.payload?.personas ?? []) as Array<{
    id: string;
    name: string;
    runtime: string;
    description: string;
    systemPrompt: string;
    model: string;
    maxTurns: number;
  }>;
}

// Pure protocol tests (create, delete, update, validation) have been migrated to
// packages/server/src/grpc-persona.test.ts as integration tests.

test.describe("Persona Management — UI", { tag: ["@persona"] }, () => {
  test("persona management view shows created personas", async ({
    appPage,
  }) => {
    const page = appPage;

    // Create a persona
    await createPersonaViaWs(page, {
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
  }) => {
    const page = appPage;

    await createPersonaViaWs(page, {
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
  }) => {
    const page = appPage;

    // Create a persona
    await createPersonaViaWs(page, {
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

    // Delete via WS
    const personas = await listPersonasViaWs(page);
    const toDelete = personas.find((p) => p.name === "Soon Deleted");
    expect(toDelete).toBeDefined();

    await sendWsAndWaitFor(
      page,
      { type: "delete_persona", payload: { personaId: toDelete!.id } },
      "persona.deleted",
    );

    // The management view should no longer show the persona
    await expect(page.getByText("Soon Deleted")).not.toBeVisible({
      timeout: 5_000,
    });
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
});
