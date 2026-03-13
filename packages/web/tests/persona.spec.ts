import { test, expect } from "./fixtures.js";
import { sendWsAndWaitFor, createProject } from "./helpers.js";

test.describe("Persona Management", () => {
  test("create persona via WebSocket and verify it appears", async ({
    appPage,
  }) => {
    const page = appPage;

    // Create a persona via WS
    await sendWsAndWaitFor(
      page,
      {
        type: "create_persona",
        payload: {
          name: "Test Engineer",
          description: "Writes tests",
          systemPrompt: "You are a test engineer. Write thorough unit tests.",
          runtime: "stub",
          model: "sonnet",
          maxTurns: 5,
        },
      },
      "persona_created",
    );

    // Query personas to verify it was created
    const response = await sendWsAndWaitFor(
      page,
      { type: "list_personas" },
      "personas",
    );
    const personas = (response.payload?.personas || []) as Array<{
      id: string;
      name: string;
      runtime: string;
    }>;
    expect(personas.length).toBeGreaterThanOrEqual(1);
    const created = personas.find((p) => p.name === "Test Engineer");
    expect(created).toBeDefined();
    expect(created!.runtime).toBe("stub");
  });

  test("persona selector appears in new task form", async ({ appPage }) => {
    const page = appPage;

    // Create a persona first
    await sendWsAndWaitFor(
      page,
      {
        type: "create_persona",
        payload: {
          name: "Frontend Dev",
          description: "React specialist",
          systemPrompt: "You are a frontend engineer.",
          runtime: "stub",
        },
      },
      "persona_created",
    );

    // Create a project
    await page.locator("button", { hasText: "+" }).first().click();
    await page
      .locator('input[placeholder="Project name..."]')
      .fill("persona-test-proj");
    await page.locator("button", { hasText: "OK" }).click();
    await expect(page.getByText("persona-test-proj")).toBeVisible({
      timeout: 5_000,
    });

    // Open new task form
    await page.getByText("persona-test-proj").click();
    await page
      .getByText("persona-test-proj")
      .locator("..")
      .locator('button[title="New task"]')
      .click();

    // Verify persona selector is present with "No persona" default and our persona
    const selects = page.locator("select");
    // There should be at least 2 selects: environment and persona
    const selectCount = await selects.count();
    expect(selectCount).toBeGreaterThanOrEqual(2);

    // Find the persona select (contains "No persona" option)
    const personaSelect = page.locator("select", {
      has: page.locator('option:text("No persona")'),
    });
    await expect(personaSelect).toBeVisible();
    await expect(
      personaSelect.locator('option:text("Frontend Dev")'),
    ).toBeVisible();
  });

  test("persona management view shows created personas", async ({
    appPage,
  }) => {
    const page = appPage;

    // Create a persona
    await sendWsAndWaitFor(
      page,
      {
        type: "create_persona",
        payload: {
          name: "Security Reviewer",
          description: "Reviews code for vulnerabilities",
          systemPrompt: "You review code for security issues.",
          runtime: "stub",
          model: "opus",
        },
      },
      "persona_created",
    );

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
    const createResponse = await sendWsAndWaitFor(
      page,
      {
        type: "create_persona",
        payload: {
          name: "Temp Persona",
          systemPrompt: "Temporary",
        },
      },
      "persona_created",
    );

    // Get the persona ID
    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_personas" },
      "personas",
    );
    const personas = (listResponse.payload?.personas || []) as Array<{
      id: string;
      name: string;
    }>;
    const temp = personas.find((p) => p.name === "Temp Persona");
    expect(temp).toBeDefined();

    // Delete it
    await sendWsAndWaitFor(
      page,
      { type: "delete_persona", payload: { personaId: temp!.id } },
      "persona_deleted",
    );

    // Verify it's gone
    const afterDelete = await sendWsAndWaitFor(
      page,
      { type: "list_personas" },
      "personas",
    );
    const remaining = (afterDelete.payload?.personas || []) as Array<{
      id: string;
      name: string;
    }>;
    expect(remaining.find((p) => p.name === "Temp Persona")).toBeUndefined();
  });

  test("update persona via WebSocket", async ({ appPage }) => {
    const page = appPage;

    // Create a persona
    await sendWsAndWaitFor(
      page,
      {
        type: "create_persona",
        payload: {
          name: "Original Name",
          systemPrompt: "Original prompt",
          runtime: "stub",
        },
      },
      "persona_created",
    );

    // Get the persona ID
    const listResponse = await sendWsAndWaitFor(
      page,
      { type: "list_personas" },
      "personas",
    );
    const personas = (listResponse.payload?.personas || []) as Array<{
      id: string;
      name: string;
    }>;
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
    const afterUpdate = await sendWsAndWaitFor(
      page,
      { type: "list_personas" },
      "personas",
    );
    const updated = (afterUpdate.payload?.personas || []) as Array<{
      id: string;
      name: string;
    }>;
    expect(updated.find((p) => p.name === "Updated Name")).toBeDefined();
    expect(updated.find((p) => p.name === "Original Name")).toBeUndefined();
  });
});
