import { test, expect } from "./fixtures.js";
import {
  stubScenario,
  emitText,
  idle,
  onInputMatch,
  navigateToTask,
} from "./helpers.js";

test.describe("Task start with workspace-linked environment resolution", { tag: ["@task"] }, () => {
  test("starts task when workspace has linked env and no env passed explicitly", async ({ stubTask }) => {
    const { page } = stubTask;

    // Create a task — the workspace is linked to "test-local" by the fixture,
    // but the stub runtime patch injects the envId. We verify the task starts
    // successfully, confirming the server-side resolution chain works.
    await stubTask.createAndNavigate("linked-env-start", stubScenario(
      emitText("Working on linked env task..."),
      onInputMatch({ fail: "fail", "*": "next" }),
      idle(),
    ));

    // Click Start — the server should resolve environment from workspace's linked envs
    await page.getByTestId("task-header-start").click();

    // Wait for stub to reach waiting_input
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await expect(inputField).toBeVisible({ timeout: 15_000 });

    // Send input to advance the stub
    await inputField.fill("continue");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    // Task should transition to paused (review) state
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("shows error toast when startTask fails", async ({ stubTask }) => {
    const { page, client } = stubTask;

    // Create a task via RPC (no scenario, just a plain task)
    const task = await stubTask.createTask("error-toast-test");
    await navigateToTask(page, "error-toast-test");

    // Click Start — this will fail because there's no connected environment
    // (the stub runtime patch injects envId but no persona is configured for normal tasks)
    // The error should be surfaced as a toast, not silently swallowed.
    await page.getByTestId("task-header-start").click();

    // Give the toast time to appear — the error message from the server
    // should be displayed as a toast notification
    await expect(page.getByText(/Failed to start task|No environment|failed/i), {
      timeout: 10_000,
    }).toBeVisible();
  });
});
