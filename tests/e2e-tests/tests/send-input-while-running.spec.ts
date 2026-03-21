import { test, expect } from "./fixtures.js";
import { createWorkspace, createTask, navigateToTask, patchWsForStubRuntime } from "./helpers.js";

test.describe("Send input while agent is running", () => {
  test("input field is enabled during active session", async ({ appPage }) => {
    const page = appPage;

    // Create workspace + task
    await createWorkspace(page, "input-while-running");
    await createTask(page, "input-while-running", "echo task", "test-local");
    await navigateToTask(page, "echo task");

    // Patch to use stub runtime
    await patchWsForStubRuntime(page);

    // Start the task
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for stub runtime events to appear (session becomes active)
    await expect(page.locator("text=Stub runtime initialized")).toBeVisible({ timeout: 15_000 });

    // The input field should be visible and enabled — not disabled with "Agent is working..."
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 10_000 });
    await expect(inputField).toBeEnabled();

    // Send input and verify it appears in the stream
    await inputField.fill("test input");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // The stub runtime echoes input back as "You said: ..."
    await expect(page.locator("text=You said: test input")).toBeVisible({ timeout: 10_000 });
  });
});
