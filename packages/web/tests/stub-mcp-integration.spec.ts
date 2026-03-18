import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  patchWsForStubMcpRuntime,
  runStubMcpTaskToCompletion,
} from "./helpers.js";

test.describe("Stub MCP Integration", () => {
  test("real MCP tool_use and tool_result rendered in UI", async ({ appPage }) => {
    const page = appPage;

    // Create project + task (task gives the spawn a real projectId for the scoped MCP token)
    await createProject(page, "mcp-int-proj");
    await createTask(page, "mcp-int-proj", "mcp test task", "test-local");
    await navigateToTask(page, "mcp test task");

    // Patch WS to use stub-mcp runtime
    await patchWsForStubMcpRuntime(page);

    // Start the task
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for system message from stub-mcp runtime
    await expect(page.locator("text=Stub MCP runtime initialized")).toBeVisible({ timeout: 15_000 });

    // Verify tool result card shows "task_list" as label (real MCP tool, not "echo")
    const toolResultLabel = page.locator('[class*="toolResultLabel"]');
    await expect(toolResultLabel.first()).toContainText("task_list", { timeout: 10_000 });

    // Verify tool result content contains parseable JSON (real MCP response)
    const toolResultPre = page.locator('[class*="toolResultPre"]');
    // Click the header to expand the result if collapsed
    const toolResultHeader = page.locator('[class*="toolResultHeader"]').first();
    await toolResultHeader.click();
    await expect(toolResultPre.first()).toBeVisible({ timeout: 5_000 });
    const resultText = await toolResultPre.first().textContent();
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
      .getByRole("button", { name: "Complete", exact: true })
      .waitFor({ timeout: 15_000 });
  });

  test("stub-mcp renders paired tool_use + tool_result correctly", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "mcp-pair-proj");
    await createTask(page, "mcp-pair-proj", "mcp pair task", "test-local");
    await navigateToTask(page, "mcp pair task");
    await patchWsForStubMcpRuntime(page);

    // Run through the full lifecycle
    await runStubMcpTaskToCompletion(page);

    // Paired tool_use events are consumed by tool_result, so no standalone tool_use cards
    const toolUseCards = page.locator('[class*="toolUseEvent"]');
    await expect(toolUseCards).toHaveCount(0);

    // The tool_result card should have a success indicator (green checkmark)
    const successIndicator = page.locator('[class*="toolResultIndicatorOk"]');
    await expect(successIndicator.first()).toBeVisible({ timeout: 5_000 });
  });
});
