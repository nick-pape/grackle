import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  navigateToTask,
  patchWsForStubMcpRuntime,
  runStubMcpTaskToCompletion,
} from "./helpers.js";

test.describe("Stub MCP Integration", { tag: ["@persona"] }, () => {
  test("real MCP tool_use and tool_result rendered in UI", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    // Create workspace + task (task gives the spawn a real workspaceId for the scoped MCP token)
    await createWorkspace(client, "mcp-int-proj");
    await createTask(client, "mcp-int-proj", "mcp test task", "test-local");
    await navigateToTask(page, "mcp test task");

    // Patch WS to use stub-mcp runtime
    await patchWsForStubMcpRuntime(page);

    // Start the task
    await page.getByTestId("task-header-start").click();

    // Wait for system message from stub runtime (unified: both "stub" and "stub-mcp" use the same session)
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });

    // Verify a tool card renders (the MCP tool_use+tool_result should produce a card)
    const toolCard = page.locator('[data-testid^="tool-card-"]').first();
    await expect(toolCard).toBeVisible({ timeout: 10_000 });

    // Verify tool card has content (specialized cards may not use "tool-card-result" testid)
    const cardText = await toolCard.textContent();
    expect(cardText).toBeTruthy();

    // Send input to complete the session
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await inputField.waitFor({ timeout: 15_000 });
    await inputField.fill("continue");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // Verify full lifecycle completes
    await page
      .getByRole("button", { name: "Resume", exact: true })
      .waitFor({ timeout: 15_000 });
  });

  test("stub-mcp renders paired tool_use + tool_result correctly", async ({ appPage, grackle: { client } }) => {
    const page = appPage;

    await createWorkspace(client, "mcp-pair-proj");
    await createTask(client, "mcp-pair-proj", "mcp pair task", "test-local");
    await navigateToTask(page, "mcp pair task");
    await patchWsForStubMcpRuntime(page);

    // Run through the full lifecycle
    await runStubMcpTaskToCompletion(page);

    // The paired tool_use+tool_result should render as a tool card (not as separate events).
    // At least one tool card should be visible (generic, shell, read, etc.)
    const toolCards = page.locator('[data-testid^="tool-card-"]');
    await expect(toolCards.first()).toBeVisible({ timeout: 5_000 });
  });
});
