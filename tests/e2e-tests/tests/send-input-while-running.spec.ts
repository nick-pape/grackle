import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTaskWithScenario,
  navigateToTask,
  patchWsForStubRuntime,
  stubScenario,
  emitText,
  waitMs,
  idle,
  onInput,
} from "./helpers.js";

test.describe("Send input while agent is running", { tag: ["@session"] }, () => {
  test("input field is enabled during active session", async ({ appPage }) => {
    const page = appPage;

    // Scenario with a wait step to keep the session "running" long enough
    // to verify the input field is enabled, followed by an idle step.
    await createWorkspace(page, "input-while-running");
    await createTaskWithScenario(page, "input-while-running", "echo task", stubScenario(
      emitText("Starting work..."),
      waitMs(2000),           // keep session running for 2s
      idle(),                 // then go idle for input
      onInput("echo"),        // echo the input back
    ));
    await navigateToTask(page, "echo task");

    // Patch to use stub runtime
    await patchWsForStubRuntime(page);

    // Start the task
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for scenario events to appear (session becomes active)
    await expect(page.locator("text=Starting work...")).toBeVisible({ timeout: 15_000 });

    // The input field should be visible and enabled — not disabled with "Agent is working..."
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 10_000 });
    await expect(inputField).toBeEnabled();

    // Wait for idle, then send input and verify it appears in the stream
    await inputField.waitFor({ timeout: 15_000 });
    await inputField.fill("test input");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // The scenario echoes input back as "You said: ..."
    await expect(page.locator("text=You said: test input")).toBeVisible({ timeout: 10_000 });
  });
});
