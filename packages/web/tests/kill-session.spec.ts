import { test, expect } from "./fixtures.js";

test.describe("Kill Session", () => {
  test("kill during waiting_input", async ({ appPage }) => {
    const page = appPage;

    // Stage2 sidebar defaults to "Projects" tab — switch to "Environments"
    await page.locator("button", { hasText: "Environments" }).click();

    // Start a stub session
    await page.locator("button", { hasText: "+" }).click();
    const runtimeSelect = page.locator("select");
    await runtimeSelect.selectOption("stub");
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

    // Status shows killed
    await expect(page.locator("text=Session killed")).toBeVisible();
  });
});
