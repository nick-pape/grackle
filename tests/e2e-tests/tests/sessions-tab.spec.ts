import { test, expect } from "./fixtures.js";

/**
 * Regression guard for #1358: ad-hoc sessions (no task) must be discoverable.
 *
 * Spawns an ad-hoc session via the New Chat flow, then verifies it surfaces on
 * the dedicated Sessions tab and that the row links through to its detail page.
 */
test.describe("Sessions tab", { tag: ["@session"] }, () => {
  test("nav tab navigates to the sessions list", async ({ appPage }) => {
    const page = appPage;

    await page.getByTestId("sidebar-tab-sessions").click();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByTestId("sessions-page")).toBeVisible();
    await expect(page.getByTestId("sidebar-tab-sessions")).toHaveAttribute("aria-selected", "true");
  });

  test("ad-hoc session is discoverable and links to its detail", async ({ appPage }) => {
    const page = appPage;

    // Spawn an ad-hoc session (no task) via Environments -> New Chat -> Go.
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await page.getByRole("button", { name: "New Chat" }).click();
    const promptInput = page.locator('textarea[placeholder="Enter prompt..."]');
    await promptInput.fill("ad hoc discovery probe");
    await page.locator("button", { hasText: "Go" }).click();
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });

    // Reload into the Sessions tab. A fresh navigation resets the in-memory
    // "auto-focus last spawned session" state, mirroring the real scenario:
    // discovering an ad-hoc session that ran earlier. The session itself is
    // durable (persisted in the DB, reloaded on connect).
    await page.goto("/sessions");
    await expect(page.getByTestId("sessions-page")).toBeVisible({ timeout: 10_000 });

    const rows = page.locator('[data-testid^="session-row-"]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    // At least one session is marked ad-hoc (not bound to a task).
    await expect(page.locator('[data-testid^="session-adhoc-"]').first()).toBeVisible();

    // Clicking a row opens that session's detail page.
    await rows
      .first()
      .getByTestId(/^session-open-/)
      .first()
      .click();
    await expect(page).toHaveURL(/\/sessions\/.+/);
    const breadcrumbs = page.getByTestId("breadcrumbs");
    await expect(breadcrumbs).toBeVisible({ timeout: 10_000 });
    await expect(breadcrumbs).toContainText("Session ");
  });

  test("opening the Sessions tab right after a spawn is not bounced back", async ({ appPage }) => {
    const page = appPage;

    // Spawn an ad-hoc session; the app auto-focuses the new session once.
    await page.locator('[data-testid="sidebar-tab-environments"]').click();
    await page.getByTestId("env-nav-item").first().click();
    await page.getByRole("button", { name: "New Chat" }).click();
    await page.locator('textarea[placeholder="Enter prompt..."]').fill("bounce check");
    await page.locator("button", { hasText: "Go" }).click();
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/sessions\/.+/);

    // Clicking the Sessions tab must land on the list and STAY there — the
    // auto-focus effect is one-shot and must not bounce navigation back to the
    // freshly spawned session (regression guard for the lastSpawnedId fix).
    await page.getByTestId("sidebar-tab-sessions").click();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByTestId("sessions-page")).toBeVisible();
  });
});
