import { test, expect } from "./fixtures.js";

test.describe("Kill Session", { tag: ["@session"] }, () => {
  test("kill during waiting_input", async ({ appPage }) => {
    const page = appPage;

    // Navigate to the Environments tab
    await page.locator('[data-testid="sidebar-tab-environments"]').click();

    // Start a stub session (uses default stub persona)
    await page.getByTestId("env-nav-item").first().click();
    await page.getByRole("button", { name: "New Chat" }).click();
    const promptInput = page.locator('input[placeholder="Enter prompt..."]');
    await promptInput.fill("kill test");
    await page.locator("button", { hasText: "Go" }).click();

    // Wait for waiting_input state
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 10_000 });

    // Click Kill via the split button dropdown (wait for session to be active first)
    await page.getByTestId("stop-split-button").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("stop-split-button-chevron").click();
    await page.locator("[data-testid='stop-split-button-menu'] button", { hasText: "Kill" }).click();

    // Session becomes killed — UnifiedBar shows "+ New Chat"
    await expect(page.locator("button", { hasText: "+ New Chat" })).toBeVisible({ timeout: 10_000 });

    // Status shows killed
    await expect(page.locator("text=Session killed")).toBeVisible();
  });
});
