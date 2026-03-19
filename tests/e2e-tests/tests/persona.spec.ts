import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor, createWorkspace } from "./helpers.js";

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

test.describe("Persona Management", () => {
  test("create persona via WebSocket and verify it appears", async ({
    appPage,
  }) => {
    const page = appPage;

    // Create a persona via WS
    await createPersonaViaWs(page, {
      name: "Test Engineer",
      description: "Writes tests",
      systemPrompt: "You are a test engineer. Write thorough unit tests.",
      runtime: "stub",
      model: "sonnet",
      maxTurns: 5,
    });

    // Query personas to verify it was created
    const personas = await listPersonasViaWs(page);
    expect(personas.length).toBeGreaterThanOrEqual(1);
    const created = personas.find((p) => p.name === "Test Engineer");
    expect(created).toBeDefined();
    expect(created!.runtime).toBe("stub");
  });

  // persona selector tests removed: persona is no longer selected in the task form;
  // it is chosen at session start time.

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
    await page.locator('button[title="Settings"]').click();
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

  test("delete persona via WebSocket", async ({ appPage }) => {
    const page = appPage;

    // Create a persona
    await createPersonaViaWs(page, {
      name: "Temp Persona",
      systemPrompt: "Temporary",
    });

    // Get the persona ID
    const personas = await listPersonasViaWs(page);
    const temp = personas.find((p) => p.name === "Temp Persona");
    expect(temp).toBeDefined();

    // Delete it
    await sendWsAndWaitFor(
      page,
      { type: "delete_persona", payload: { personaId: temp!.id } },
      "persona.deleted",
    );

    // Verify it's gone
    const remaining = await listPersonasViaWs(page);
    expect(remaining.find((p) => p.name === "Temp Persona")).toBeUndefined();
  });

  test("update persona via WebSocket", async ({ appPage }) => {
    const page = appPage;

    // Create a persona
    await createPersonaViaWs(page, {
      name: "Original Name",
      systemPrompt: "Original prompt",
      runtime: "stub",
    });

    // Get the persona ID
    const personas = await listPersonasViaWs(page);
    const original = personas.find((p) => p.name === "Original Name");
    expect(original).toBeDefined();

    // Update it
    await sendWsAndWaitFor(
      page,
      {
        type: "update_persona",
        payload: {
          personaId: original!.id,
          name: "Updated Name",
          systemPrompt: "Updated prompt",
        },
      },
      "persona.updated",
    );

    // Verify the update
    const updated = await listPersonasViaWs(page);
    expect(updated.find((p) => p.name === "Updated Name")).toBeDefined();
    expect(updated.find((p) => p.name === "Original Name")).toBeUndefined();
  });

  // ─── Additional robustness tests ──────────────────────────

  test("create persona with all fields and verify full round-trip", async ({
    appPage,
  }) => {
    const page = appPage;

    await createPersonaViaWs(page, {
      name: "Full Fields Persona",
      description: "Has every field set",
      systemPrompt: "You are a comprehensive persona.",
      runtime: "stub",
      model: "opus",
      maxTurns: 25,
    });

    const personas = await listPersonasViaWs(page);
    const p = personas.find((x) => x.name === "Full Fields Persona");
    expect(p).toBeDefined();
    expect(p!.description).toBe("Has every field set");
    expect(p!.systemPrompt).toBe("You are a comprehensive persona.");
    expect(p!.runtime).toBe("stub");
    expect(p!.model).toBe("opus");
    expect(p!.maxTurns).toBe(25);
  });

  test("create persona with minimal fields defaults correctly", async ({
    appPage,
  }) => {
    const page = appPage;

    await createPersonaViaWs(page, {
      name: "Minimal Persona",
      systemPrompt: "Just a prompt.",
    });

    const personas = await listPersonasViaWs(page);
    const p = personas.find((x) => x.name === "Minimal Persona");
    expect(p).toBeDefined();
    expect(p!.description).toBe("");
    expect(p!.runtime).toBe("stub"); // default from helper
    expect(p!.model).toBe("");
    expect(p!.maxTurns).toBe(0);
  });

  test("creating persona without name returns error", async ({ appPage }) => {
    const page = appPage;

    const response = await sendWsAndWaitFor(
      page,
      {
        type: "create_persona",
        payload: {
          name: "",
          systemPrompt: "missing name",
        },
      },
      "error",
    );
    expect(response.payload?.message).toBeTruthy();
  });

  test("creating persona without systemPrompt returns error", async ({
    appPage,
  }) => {
    const page = appPage;

    const response = await sendWsAndWaitFor(
      page,
      {
        type: "create_persona",
        payload: {
          name: "No Prompt",
          systemPrompt: "",
        },
      },
      "error",
    );
    expect(response.payload?.message).toBeTruthy();
  });

  test("deleting non-existent persona does not crash", async ({ appPage }) => {
    const page = appPage;

    // Sending delete for a bogus ID should not produce an error that breaks the WS.
    // The server silently succeeds (DELETE WHERE id = 'nope' is a no-op).
    await sendWsAndWaitFor(
      page,
      { type: "delete_persona", payload: { personaId: "nonexistent-id" } },
      "persona.deleted",
    );

    // Verify WS is still healthy by listing personas
    const personas = await listPersonasViaWs(page);
    expect(Array.isArray(personas)).toBe(true);
  });

  test("update preserves fields that are not provided", async ({
    appPage,
  }) => {
    const page = appPage;

    // Create with specific fields
    await createPersonaViaWs(page, {
      name: "Preserve Test",
      description: "Original desc",
      systemPrompt: "Original system prompt",
      runtime: "stub",
      model: "sonnet",
      maxTurns: 10,
    });

    const personas = await listPersonasViaWs(page);
    const p = personas.find((x) => x.name === "Preserve Test");
    expect(p).toBeDefined();

    // Update only the name — server should keep other fields
    await sendWsAndWaitFor(
      page,
      {
        type: "update_persona",
        payload: {
          personaId: p!.id,
          name: "Preserve Test Renamed",
        },
      },
      "persona.updated",
    );

    const after = await listPersonasViaWs(page);
    const renamed = after.find((x) => x.name === "Preserve Test Renamed");
    expect(renamed).toBeDefined();
    // These fields should be preserved from the original creation
    expect(renamed!.description).toBe("Original desc");
    expect(renamed!.systemPrompt).toBe("Original system prompt");
    expect(renamed!.runtime).toBe("stub");
    expect(renamed!.model).toBe("sonnet");
    expect(renamed!.maxTurns).toBe(10);
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
    await page.locator('button[title="Settings"]').click();
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
    await page.locator('button[title="Settings"]').click();
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

    await page.locator('button[title="Settings"]').click();
    await page.getByRole("tab", { name: "Personas" }).click();

    const breadcrumbs = page.getByTestId("breadcrumbs");
    await expect(breadcrumbs).toBeVisible({ timeout: 5_000 });
    await expect(breadcrumbs).toContainText("Home");
    await expect(breadcrumbs).toContainText("Settings");
  });
});
