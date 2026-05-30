import { test, expect } from "./fixtures.js";

/**
 * Coverage for issue #1413 — Persona Library promoted to a top-level surface.
 * Asserts the new sidebar tab + URL, and back-compat redirects from the
 * legacy /settings/personas* URLs.
 */
test.describe(
  "Persona Library — top-level surface",
  { tag: ["@persona", "@persona-library"] },
  () => {
    test("Personas tab in AppNav navigates to /personas and is selected", async ({ appPage }) => {
      const page = appPage;

      await page.locator('[data-testid="sidebar-tab-personas"]').click();
      await expect(page).toHaveURL(/\/personas$/, { timeout: 5_000 });
      // The AppNav tab uses role=tab with aria-selected driven by getActiveView.
      await expect(page.getByRole("tab", { name: "Personas", selected: true })).toBeVisible({
        timeout: 5_000,
      });
      // The PersonaManager renders an h2 with the page title.
      await expect(page.getByRole("heading", { name: "Personas" })).toBeVisible({ timeout: 5_000 });
    });

    test("legacy /settings/personas redirects to /personas", async ({ appPage }) => {
      const page = appPage;

      await page.goto("/settings/personas");
      await expect(page).toHaveURL(/\/personas$/, { timeout: 5_000 });
    });

    test("legacy /settings/personas/new redirects to /personas/new", async ({ appPage }) => {
      const page = appPage;

      await page.goto("/settings/personas/new");
      await expect(page).toHaveURL(/\/personas\/new$/, { timeout: 5_000 });
    });

    test("legacy /settings/personas/:personaId preserves the id in the redirect", async ({
      appPage,
      grackle: { client },
    }) => {
      const page = appPage;

      // Create a persona via gRPC so the detail route resolves to an existing record.
      const persona = await client.orchestration.createPersona({
        name: "Redirect Subject",
        systemPrompt: "Used to exercise the /settings/personas/:id redirect.",
        runtime: "stub",
        model: "sonnet",
      });

      await page.goto(`/settings/personas/${persona.id}`);
      await expect(page).toHaveURL(new RegExp(`/personas/${persona.id}$`), { timeout: 5_000 });
    });
  },
);
