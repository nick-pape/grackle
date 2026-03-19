import { test, expect } from "./fixtures.js";

test.describe("Kill Session", () => {
  test("kill during waiting_input", async ({ appPage }) => {
    const page = appPage;

    // Environments are now in Settings — navigate there via the gear button
    await page.locator('button[title="Settings"]').click();

    // Start a stub session (uses default stub persona)
    await page.locator('button[title="New chat"]').click();
    const promptInput = page.locator('input[placeholder="Enter prompt..."]');
    await promptInput.fill("kill test");
    await page.locator("button", { hasText: "Go" }).click();

    // Wait for waiting_input state
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 10_000 });

    // Click Stop
    await page.locator("button", { hasText: "Stop" }).click();

    // Session becomes killed — UnifiedBar shows "+ New Chat"
    await expect(page.locator("button", { hasText: "+ New Chat" })).toBeVisible({ timeout: 10_000 });

    // Status shows interrupted
    await expect(page.locator("text=Session interrupted")).toBeVisible();
  });
});
