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

    // Create a task in a workspace that is linked to "test-local" by the fixture.
    // The stub fetch patch injects personaId="stub" but does NOT inject environmentId
    // (only injects when environmentId is null/undefined, not when it is "").
    // So the StartTask request reaches the server with environmentId="" and the
    // server resolves it via the workspace's linkedEnvironmentIds fallback.
    await stubTask.createAndNavigate("linked-env-start", stubScenario(
      emitText("Working on linked env task..."),
      onInputMatch({ fail: "fail", "*": "next" }),
      idle(),
    ));

    // Click Start — server resolves environment from workspace's linked envs
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

    await stubTask.createTask("error-toast-test");
    await navigateToTask(page, "error-toast-test");

    // Stop the environment so StartTask fails with "Environment not connected".
    // The server resolves environmentId via the workspace fallback ("test-local")
    // but it is now disconnected → FailedPrecondition error.
    // That error must surface as a toast rather than being silently swallowed.
    await client.core.stopEnvironment({ id: "test-local" });

    await page.getByTestId("task-header-start").click();

    await expect(
      page.getByText(/not connected|Failed to start task/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});
