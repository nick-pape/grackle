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
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for system message from stub-mcp runtime
    await expect(page.locator("text=Stub MCP runtime initialized")).toBeVisible({ timeout: 15_000 });

    // Verify tool result card shows "task_list" as label (real MCP tool, not "echo")
    await expect(page.getByTestId("tool-result-label").first()).toContainText("task_list", { timeout: 10_000 });

    // Verify tool result content contains parseable JSON (real MCP response)
    // Click the header to expand the result if collapsed
    await page.getByTestId("tool-result-header").first().click();
    const toolResultContent = page.getByTestId("tool-result-content").first();
    await expect(toolResultContent).toBeVisible({ timeout: 5_000 });
    const resultText = await toolResultContent.textContent();
    expect(resultText).toBeTruthy();
    // The MCP response should be valid JSON
    expect(() => JSON.parse(resultText!)).not.toThrow();

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

    // Paired tool_use events are consumed by tool_result, so no standalone tool_use cards
    const toolUseCards = page.locator('[class*="toolUseEvent"]');
    await expect(toolUseCards).toHaveCount(0);

    // The tool_result card should have a success indicator (green checkmark)
    await expect(page.getByTestId("tool-result-indicator-ok").first()).toBeVisible({ timeout: 5_000 });
  });
});
