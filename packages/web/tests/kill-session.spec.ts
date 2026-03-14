import { test, expect } from "./fixtures.js";
import { getNewChatRuntimeSelect } from "./helpers.js";

test.describe("Kill Session", () => {
  test("kill during waiting_input", async ({ appPage }) => {
    const page = appPage;

    // Environments are now in Settings — navigate there via the gear button
    await page.locator('button[title="Settings"]').click();

    // Start a stub session
    await page.locator('button[title="New chat"]').click();
    const runtimeSelect = getNewChatRuntimeSelect(page);
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
