import { test, expect } from "./fixtures.js";
import { getNewChatRuntimeSelect } from "./helpers.js";

test.describe("Copilot Runtime Option", () => {
  test.beforeEach(async ({ appPage }) => {
    // Environments are now in Settings — navigate there via the gear button
    await appPage.locator('button[title="Settings"]').click();
    await appPage.locator('button[title="New chat"]').click();
    await expect(appPage.getByText("new chat", { exact: true })).toBeVisible();
  });

  test("copilot option appears in runtime selector", async ({ appPage }) => {
    const page = appPage;
    const runtimeSelect = getNewChatRuntimeSelect(page);
    await expect(runtimeSelect).toBeVisible();

    // Verify all runtime options are present in alphabetical order
    const options = runtimeSelect.locator("option");
    await expect(options).toHaveCount(7);
    await expect(options.nth(0)).toHaveText("claude-code");
    await expect(options.nth(1)).toHaveText("codex");
    await expect(options.nth(2)).toHaveText("copilot");
    await expect(options.nth(3)).toHaveText("stub");
    await expect(options.nth(4)).toHaveText("claude-code-acp (experimental)");
    await expect(options.nth(5)).toHaveText("codex-acp (experimental)");
    await expect(options.nth(6)).toHaveText("copilot-acp (experimental)");
  });

  test("copilot can be selected as the runtime", async ({ appPage }) => {
    const page = appPage;
    const runtimeSelect = getNewChatRuntimeSelect(page);

    // Select copilot runtime
    await runtimeSelect.selectOption("copilot");

    // Verify it's now the selected value
    await expect(runtimeSelect).toHaveValue("copilot");
  });

  test("copilot selection persists after typing a prompt", async ({ appPage }) => {
    const page = appPage;
    const runtimeSelect = getNewChatRuntimeSelect(page);

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
    const runtimeSelect = getNewChatRuntimeSelect(page);

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
