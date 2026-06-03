/**
 * E2E tests for agent tab navigation (#1419).
 *
 * Verifies the agent detail page tab bar (Chat / Sessions / Schedules /
 * Settings), URL routing, context-nav agent selection, fleet rail items,
 * and AppNav visibility toggling between Code and Agent contexts.
 */
import { test, expect } from "./fixtures.js";

/** Generate a unique agent name to avoid cross-test collisions. */
function uniqueAgentName(prefix: string): string {
  return `${prefix}-${Math.floor(Date.now() / 1000)}-${Math.floor(Math.random() * 10000)}`;
}

test.describe("Agent View — tab navigation", { tag: ["@agent", "@webui"] }, () => {
  test("navigates between agent tabs and verifies URLs and tab content", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;
    const agentName = uniqueAgentName("TabNav");

    // 1. Create an agent via gRPC
    const agent = await client.orchestration.createAgent({
      name: agentName,
      environmentId: "test-local",
      primaryPersonaId: "stub",
    });

    // 2. Navigate to the agent by clicking it in the context nav rail.
    //    The dynamic test id is `context-agent-<id>` (set in App.tsx).
    const contextItem = page.locator(`[data-testid="context-agent-${agent.id}"]`);
    await contextItem.waitFor({ state: "visible", timeout: 10_000 });
    await contextItem.click();

    // 3. Verify Chat tab is the default
    await expect(page).toHaveURL(new RegExp(`/agents/${agent.id}$`), { timeout: 5_000 });
    await expect(
      page.locator('[data-testid="agent-chat-tab"], [data-testid="agent-chat-tab-empty"]'),
    ).toBeVisible({ timeout: 5_000 });

    // Verify the agent tab bar itself is rendered
    await expect(page.locator('[data-testid="agent-tab-bar"]')).toBeVisible();

    // 4. Click Sessions tab — verify URL and tab content
    await page.locator('[data-testid="agent-tab-sessions"]').click();
    await expect(page).toHaveURL(new RegExp(`/agents/${agent.id}/sessions`), { timeout: 5_000 });
    await expect(
      page.locator('[data-testid="agent-sessions-tab"], [data-testid="agent-sessions-tab-empty"]'),
    ).toBeVisible({ timeout: 5_000 });

    // 5. Click Schedules tab — verify URL and tab content
    await page.locator('[data-testid="agent-tab-schedules"]').click();
    await expect(page).toHaveURL(new RegExp(`/agents/${agent.id}/schedules`), { timeout: 5_000 });
    await expect(
      page.locator(
        '[data-testid="agent-schedules-tab"], [data-testid="agent-schedules-tab-empty"]',
      ),
    ).toBeVisible({ timeout: 5_000 });

    // 6. Click Settings tab — verify URL and tab content
    await page.locator('[data-testid="agent-tab-settings"]').click();
    await expect(page).toHaveURL(new RegExp(`/agents/${agent.id}/settings`), { timeout: 5_000 });
    await expect(page.locator('[data-testid="agent-settings-tab"]')).toBeVisible({
      timeout: 5_000,
    });
  });

  test("AppNav is hidden on agent pages but visible on Code pages", async ({
    appPage,
    grackle: { client },
  }) => {
    const page = appPage;
    const agentName = uniqueAgentName("AppNav");

    // On the default Code landing page, AppNav should be visible
    await expect(page.locator('[data-testid="sidebar-nav"]')).toBeVisible({ timeout: 5_000 });

    // Create an agent and navigate to it
    const agent = await client.orchestration.createAgent({
      name: agentName,
      environmentId: "test-local",
      primaryPersonaId: "stub",
    });

    const contextItem = page.locator(`[data-testid="context-agent-${agent.id}"]`);
    await contextItem.waitFor({ state: "visible", timeout: 10_000 });
    await contextItem.click();

    // Wait for the agent layout to render
    await expect(page.locator('[data-testid="agent-tab-bar"]')).toBeVisible({ timeout: 5_000 });

    // AppNav should NOT be visible on agent pages (hasOwnNav suppresses it)
    await expect(page.locator('[data-testid="sidebar-nav"]')).not.toBeVisible();

    // Navigate back to Code context
    await page.locator('[data-testid="context-code"]').click();
    await expect(page).toHaveURL(/\/chat/, { timeout: 5_000 });

    // Code tab bar should be visible again
    await expect(page.locator('[data-testid="sidebar-nav"]')).toBeVisible({ timeout: 5_000 });
  });

  test("fleet rail shows Personas, Environments, and Schedules tabs in Code context", async ({
    appPage,
  }) => {
    const page = appPage;

    // Verify the fleet rail items are visible from the default Code landing
    await expect(page.locator('[data-testid="sidebar-tab-personas"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="sidebar-tab-environments"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="sidebar-tab-schedules"]')).toBeVisible({
      timeout: 5_000,
    });
  });
});
