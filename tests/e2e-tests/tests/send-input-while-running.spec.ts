import { test, expect } from "./fixtures.js";
import {
  stubScenario,
  emitText,
  emitToolUse,
  emitToolResult,
  idle,
} from "./helpers.js";

test.describe("Send input while agent is running", { tag: ["@session"] }, () => {
  test("input field is enabled during active session", async ({ stubTask }) => {
    const { page } = stubTask;

    // Scenario: emit events, go idle, echo input by default
    await stubTask.createAndNavigate("echo task", stubScenario(
      emitText("Starting work..."),
      emitToolUse("echo", { message: "test" }),
      emitToolResult("done"),
      idle(),                 // go idle for input (default handler: echo)
    ));

    // Start the task
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for scenario events to appear (session becomes active)
    await expect(page.getByText("Starting work...", { exact: true })).toBeVisible({ timeout: 15_000 });

    // The input field should be visible and enabled — not disabled with "Agent is working..."
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 10_000 });
    await expect(inputField).toBeEnabled();

    // Send input and verify it appears in the stream
    await inputField.fill("test input");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // The scenario echoes input back as "You said: ..."
    await expect(page.getByText("You said: test input", { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
