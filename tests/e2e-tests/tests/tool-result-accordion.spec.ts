import { test, expect } from "./fixtures.js";
import {
  stubScenario,
  emitToolUse,
  emitToolResult,
  idle,
} from "./helpers.js";

/**
 * Tests for tool card rendering in the session event stream (#303, #935).
 *
 * Uses the stub runtime to produce real tool_use and tool_result events
 * through the server's event pipeline. Covers:
 *  - Unpaired tool_result renders as a generic tool card
 *  - Paired tool_use+tool_result renders as specialized card (ShellCard, etc.)
 *  - Unpaired tool_use renders as in-progress card
 */

test.describe("Tool card rendering (#935)", { tag: ["@webui"] }, () => {
  test("unpaired tool_result renders as generic tool card", async ({ stubTask }) => {
    const { page } = stubTask;

    // Scenario: emit a tool_result without a preceding tool_use
    await stubTask.createAndNavigate(
      "unpaired-result",
      stubScenario(emitToolResult('Tool output: "hello world"'), idle()),
    );

    // Start the task and wait for idle
    await page.getByTestId("task-header-start").click();
    await page.locator('input[placeholder="Type a message..."]').waitFor({ timeout: 15_000 });

    // Switch to stream tab
    await page.locator("button", { hasText: "Stream" }).click();

    // The generic tool card should appear (no matching tool_use to pair with)
    const toolCard = page.getByTestId("tool-card-generic");
    await expect(toolCard).toBeVisible({ timeout: 5_000 });

    // Content should appear in the result area
    await expect(page.getByTestId("tool-card-result")).toContainText("hello world");
  });

  test("paired tool_use+tool_result renders as specialized card and hides standalone tool_use", async ({ stubTask }) => {
    const { page } = stubTask;

    // Scenario: tool_use followed by tool_result (stub runtime auto-generates matching IDs)
    await stubTask.createAndNavigate(
      "paired-tools",
      stubScenario(
        emitToolUse("Bash", { command: "ls -la /tmp" }),
        emitToolResult("total 12\ndrwxrwxrwt 5 root root 4096 Mar 14"),
        idle(),
      ),
    );

    await page.getByTestId("task-header-start").click();
    await page.locator('input[placeholder="Type a message..."]').waitFor({ timeout: 15_000 });
    await page.locator("button", { hasText: "Stream" }).click();

    // Should render as a ShellCard with the command visible
    const shellCard = page.getByTestId("tool-card-shell");
    await expect(shellCard).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("tool-card-command")).toHaveText("ls -la /tmp");

    // The standalone tool_use card should be consumed by pairing — only one shell card
    await expect(page.getByTestId("tool-card-shell")).toHaveCount(1);
  });

  test("unpaired tool_use renders as in-progress card", async ({ stubTask }) => {
    const { page } = stubTask;

    // Scenario: tool_use without a following tool_result
    await stubTask.createAndNavigate(
      "unpaired-use",
      stubScenario(emitToolUse("Read", { file_path: "/src/index.ts" }), idle()),
    );

    await page.getByTestId("task-header-start").click();
    await page.locator('input[placeholder="Type a message..."]').waitFor({ timeout: 15_000 });
    await page.locator("button", { hasText: "Stream" }).click();

    // Should render as a FileReadCard (in-progress, no result)
    await expect(page.getByTestId("tool-card-file-read")).toBeVisible({ timeout: 5_000 });
  });
});
