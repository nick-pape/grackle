import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTaskWithScenario,
  navigateToTask,
  patchWsForStubRuntime,
  stubScenario,
  emitText,
  idle,
  onInput,
} from "./helpers.js";

/** Start a task, wait for idle, send input to advance past idle. */
async function runScenarioToCompletion(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Start", exact: true }).click();

  const inputField = page.locator('input[placeholder="Type a message..."]');
  await inputField.waitFor({ timeout: 15_000 });
  await inputField.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ timeout: 15_000 });
}

test.describe("Task Stop & Pause buttons", { tag: ["@task"] }, () => {
  test("Stop button completes a paused task", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "stop-task-proj");
    await createTaskWithScenario(page, "stop-task-proj", "stop task", stubScenario(
      emitText("Processing..."),
      idle(),
      onInput("next"),
    ));
    await navigateToTask(page, "stop task");
    await patchWsForStubRuntime(page);
    await runScenarioToCompletion(page);

    // Task is now paused — Resume confirms paused state
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({ timeout: 5_000 });

    // Click Stop (should kill active sessions + mark task complete)
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Task status should become complete
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 10_000 });

    // Delete button should be visible (complete state actions)
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("paused state shows Stop and Resume buttons", async ({ appPage }) => {
    const page = appPage;

    // Scenario with just an idle step — task goes to paused immediately
    await createWorkspace(page, "pause-task-proj");
    await createTaskWithScenario(page, "pause-task-proj", "pause task", stubScenario(
      emitText("Working..."),
      idle(),
    ));
    await navigateToTask(page, "pause task");
    await patchWsForStubRuntime(page);

    // Start the task — the scenario transitions to idle, causing paused state
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Wait for the task to reach paused state (Resume only appears in paused)
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({ timeout: 15_000 });

    // Stop and Delete buttons should also be visible
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("paused task can be resumed", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "resume-task-proj");
    await createTaskWithScenario(page, "resume-task-proj", "resume task", stubScenario(
      emitText("Processing..."),
      idle(),
      onInput("next"),
    ));
    await navigateToTask(page, "resume task");
    await patchWsForStubRuntime(page);
    await runScenarioToCompletion(page);

    // Task is paused — Resume button should be visible
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({ timeout: 5_000 });

    // Resume the task
    await page.getByRole("button", { name: "Resume", exact: true }).click();

    // Task should go back to working/paused — Stop button reappears
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({ timeout: 15_000 });
  });
});
