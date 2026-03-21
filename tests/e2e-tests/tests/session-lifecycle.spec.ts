import { test, expect } from "./fixtures.js";

test.describe("Session Lifecycle (stub runtime)", () => {
  test("full stub session flow", async ({ appPage }) => {
    const page = appPage;

    // Navigate to the Environments tab
    await page.locator('[data-testid="sidebar-tab-environments"]').click();

    // Click "+" on the environment card to enter new_chat mode
    await page.locator('button[title="New chat"]').click();

    // UnifiedBar shows prompt input, persona selector, and Go button
    await expect(page.getByText("new chat", { exact: true })).toBeVisible();
    const goButton = page.locator("button", { hasText: "Go" });
    await expect(goButton).toBeVisible();

    // Go button disabled when no text
    await expect(goButton).toBeDisabled();

    // Type prompt, click Go (uses default stub persona)
    const promptInput = page.locator('input[placeholder="Enter prompt..."]');
    await promptInput.fill("hello world");
    await expect(goButton).toBeEnabled();
    await goButton.click();

    // Session spawns — events start streaming in
    // System event: "Stub runtime initialized"
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 10_000 });

    // Session breadcrumb should appear once the spawned session is selected.
    const breadcrumbs = page.getByTestId("breadcrumbs");
    await expect(breadcrumbs).toBeVisible({ timeout: 10_000 });
    await expect(breadcrumbs).toContainText("Home");
    await expect(breadcrumbs).toContainText("Session ");

    // Echo event: "Echo: hello world"
    await expect(page.locator("text=Echo: hello world")).toBeVisible();

    // Tool use event renders (blue-bordered box with monospace font)
    const toolUseBox = page.locator("div").filter({ hasText: '"message"' }).filter({ hasText: "echo:" });
    await expect(toolUseBox.first()).toBeVisible();

    // Tool result renders (preview + accordion with success indicator and label)
    await expect(page.getByText("Tool output", { exact: true })).toBeVisible();

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
