import { test, expect } from "./fixtures.js";

test.describe("Copilot Runtime Option", () => {
  test.beforeEach(async ({ appPage }) => {
    // Switch to Environments tab and enter new_chat mode
    await appPage.locator("button", { hasText: "Environments" }).click();
    await appPage.locator("button", { hasText: "+" }).click();
    await expect(appPage.locator("text=new chat")).toBeVisible();
  });

  test("copilot option appears in runtime selector", async ({ appPage }) => {
    const page = appPage;
    const runtimeSelect = page.locator("select");
    await expect(runtimeSelect).toBeVisible();

    // Verify copilot is the second option (between claude-code and stub)
    const options = runtimeSelect.locator("option");
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveText("claude-code");
    await expect(options.nth(1)).toHaveText("copilot");
    await expect(options.nth(2)).toHaveText("stub");
  });

  test("copilot can be selected as the runtime", async ({ appPage }) => {
    const page = appPage;
    const runtimeSelect = page.locator("select");

    // Select copilot runtime
    await runtimeSelect.selectOption("copilot");

    // Verify it's now the selected value
    await expect(runtimeSelect).toHaveValue("copilot");
  });

  test("copilot selection persists after typing a prompt", async ({ appPage }) => {
    const page = appPage;
    const runtimeSelect = page.locator("select");

    // Select copilot, type a prompt
    await runtimeSelect.selectOption("copilot");
    const promptInput = page.locator('input[placeholder="Enter prompt..."]');
    await promptInput.fill("test copilot prompt");

    // Runtime selection should still be copilot
    await expect(runtimeSelect).toHaveValue("copilot");

    // Go button should be enabled
    await expect(page.locator("button", { hasText: "Go" })).toBeEnabled();
  });

  test("switching between runtimes updates selector value", async ({ appPage }) => {
    const page = appPage;
    const runtimeSelect = page.locator("select");

    // Default runtime is "stub" (set by global-setup via --runtime stub)
    await expect(runtimeSelect).toHaveValue("stub");

    await runtimeSelect.selectOption("copilot");
    await expect(runtimeSelect).toHaveValue("copilot");

    await runtimeSelect.selectOption("claude-code");
    await expect(runtimeSelect).toHaveValue("claude-code");

    await runtimeSelect.selectOption("copilot");
    await expect(runtimeSelect).toHaveValue("copilot");
  });
});
