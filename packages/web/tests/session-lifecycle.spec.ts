import { test, expect } from "./fixtures.js";

test.describe("Session Lifecycle (stub runtime)", () => {
  test("full stub session flow", async ({ appPage }) => {
    const page = appPage;

    // Stage2 sidebar defaults to "Projects" tab — switch to "Environments"
    await page.locator("button", { hasText: "Environments" }).click();

    // Click "+" to enter new_chat mode
    await page.locator("button", { hasText: "+" }).click();

    // UnifiedBar shows prompt input, runtime selector, and Go button
    await expect(page.locator("text=new chat")).toBeVisible();
    const goButton = page.locator("button", { hasText: "Go" });
    await expect(goButton).toBeVisible();

    // Runtime selector has options
    const runtimeSelect = page.locator("select");
    await expect(runtimeSelect).toBeVisible();
    const options = runtimeSelect.locator("option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveText("claude-code");
    await expect(options.nth(1)).toHaveText("copilot");
    await expect(options.nth(2)).toHaveText("stub");

    // Go button disabled when no text
    await expect(goButton).toBeDisabled();

    // Select stub runtime, type prompt, click Go
    await runtimeSelect.selectOption("stub");
    const promptInput = page.locator('input[placeholder="Enter prompt..."]');
    await promptInput.fill("hello world");
    await expect(goButton).toBeEnabled();
    await goButton.click();

    // Session spawns — events start streaming in
    // System event: "Stub runtime initialized"
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });

    // Echo event: "Echo: hello world"
    await expect(page.locator("text=Echo: hello world")).toBeVisible();

    // Tool use event renders (blue-bordered box with monospace font)
    const toolUseBox = page.locator("div").filter({ hasText: '"message"' }).filter({ hasText: "echo:" });
    await expect(toolUseBox.first()).toBeVisible();

    // Tool result renders (collapsible details)
    await expect(page.locator("summary", { hasText: "Tool output" })).toBeVisible();

    // Session reaches waiting_input — UnifiedBar shows text input + Send + Stop
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("button", { hasText: "Send" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Stop" })).toBeVisible();

    // Send input
    await inputField.fill("follow up");
    await page.locator("button", { hasText: "Send" }).click();

    // "You said: follow up" text appears
    await expect(page.locator("text=You said: follow up")).toBeVisible({ timeout: 10_000 });

    // Session completes — UnifiedBar shows "Session completed" + "+ New Chat"
    await expect(page.locator("text=Session completed")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("button", { hasText: "+ New Chat" })).toBeVisible();
  });
});
