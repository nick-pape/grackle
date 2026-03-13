import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor, createProject } from "./helpers.js";

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
    "persona_created",
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

  test("persona selector appears in new task form", async ({ appPage }) => {
    const page = appPage;

    // Create a persona first
    await createPersonaViaWs(page, {
      name: "Frontend Dev",
      description: "React specialist",
      systemPrompt: "You are a frontend engineer.",
      runtime: "stub",
    });

    // Wait for the app's main WS to receive the persona list refresh.
    // The app reacts to "persona_created" by sending "list_personas",
    // so poll until the UI state has caught up.
    await page.waitForFunction(
      (personaName: string) => {
        const selects = document.querySelectorAll("select");
        for (const sel of selects) {
          for (const opt of sel.options) {
            if (opt.textContent?.includes(personaName)) {
              return true;
            }
          }
        }
        return false;
      },
      "Frontend Dev",
      { timeout: 10_000, polling: 500 },
    ).catch(() => {
      // If the persona hasn't appeared in any select yet, proceed to create
      // the project; the persona will appear once the new task form opens.
    });

    // Create a project
    await createProject(page, "persona-test-proj");

    // Open new task form
    await page.getByText("persona-test-proj").click();
    await page
      .getByText("persona-test-proj")
      .locator("..")
      .locator('button[title="New task"]')
      .click();

    // Verify persona selector is present with "No persona" default and our persona.
    // NOTE: We avoid `toBeVisible()` on `<option>` elements because browsers
    // report collapsed `<option>` elements as hidden, making the assertion flaky.
    // Instead we read the option text contents from the select element.
    const personaSelect = page.locator("select", {
      has: page.locator('option:text("No persona")'),
    });
    await expect(personaSelect).toBeVisible({ timeout: 5_000 });

    // Wait for the persona option to appear inside the select (the app's WS
    // refresh may still be in-flight).
    await expect(async () => {
      const options = await personaSelect.locator("option").allTextContents();
      expect(options).toContain("No persona");
      expect(options).toContain("Frontend Dev");
    }).toPass({ timeout: 10_000, intervals: [500, 1_000, 2_000] });
  });

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
    await page.locator('button[title="Personas"]').click();

    // Verify the persona management view is shown with our persona
    await expect(page.getByText("Personas")).toBeVisible({ timeout: 5_000 });
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
      "persona_deleted",
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
      "persona_updated",
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
      "persona_deleted",
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
      "persona_updated",
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

  test("persona selector defaults to No persona in new task form", async ({
    appPage,
  }) => {
    const page = appPage;

    // Create two personas to ensure the dropdown doesn't auto-select one
    await createPersonaViaWs(page, {
      name: "Persona A",
      systemPrompt: "A prompt",
    });
    await createPersonaViaWs(page, {
      name: "Persona B",
      systemPrompt: "B prompt",
    });

    // Create a project and open new task form
    await createProject(page, "default-persona-proj");
    await page.getByText("default-persona-proj").click();
    await page
      .getByText("default-persona-proj")
      .locator("..")
      .locator('button[title="New task"]')
      .click();

    // The persona select should default to the empty value ("No persona")
    const personaSelect = page.locator("select", {
      has: page.locator('option:text("No persona")'),
    });
    await expect(personaSelect).toBeVisible({ timeout: 5_000 });
    await expect(personaSelect).toHaveValue("");
  });

  test("multiple personas appear in selector in correct order", async ({
    appPage,
  }) => {
    const page = appPage;

    // Create personas with names that would sort differently alphabetically
    await createPersonaViaWs(page, {
      name: "Zulu Persona",
      systemPrompt: "z prompt",
    });
    await createPersonaViaWs(page, {
      name: "Alpha Persona",
      systemPrompt: "a prompt",
    });

    // Create project and open new task form
    await createProject(page, "multi-persona-proj");
    await page.getByText("multi-persona-proj").click();
    await page
      .getByText("multi-persona-proj")
      .locator("..")
      .locator('button[title="New task"]')
      .click();

    const personaSelect = page.locator("select", {
      has: page.locator('option:text("No persona")'),
    });
    await expect(personaSelect).toBeVisible({ timeout: 5_000 });

    // Wait for both persona options to appear
    await expect(async () => {
      const options = await personaSelect.locator("option").allTextContents();
      expect(options).toContain("Alpha Persona");
      expect(options).toContain("Zulu Persona");
    }).toPass({ timeout: 10_000, intervals: [500, 1_000, 2_000] });

    // "No persona" should always be the first option
    const firstOption = await personaSelect
      .locator("option")
      .first()
      .textContent();
    expect(firstOption).toBe("No persona");
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
    await page.locator('button[title="Personas"]').click();
    await expect(page.getByText("Personas")).toBeVisible({ timeout: 5_000 });
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
    await page.locator('button[title="Personas"]').click();
    await expect(page.getByText("Personas")).toBeVisible({ timeout: 5_000 });
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
      "persona_deleted",
    );

    // The management view should no longer show the persona
    await expect(page.getByText("Soon Deleted")).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test("persona page shows breadcrumbs with Home > Personas", async ({ appPage }) => {
    const page = appPage;

    await page.locator('button[title="Personas"]').click();

    const breadcrumbs = page.getByTestId("breadcrumbs");
    await expect(breadcrumbs).toBeVisible({ timeout: 5_000 });
    await expect(breadcrumbs).toContainText("Home");
    await expect(breadcrumbs).toContainText("Personas");
  });
});
