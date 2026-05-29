import { test, expect } from "./fixtures.js";
import { stubScenario, emitText, idle, onInput } from "./helpers.js";

/** Start a task, wait for idle, send input to advance past idle. */
async function runScenarioToCompletion(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("task-header-start").click();

  const inputField = page.locator('textarea[placeholder="Type a message..."]');
  await inputField.waitFor({ timeout: 15_000 });
  await inputField.fill("continue");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.getByRole("button", { name: "Resume", exact: true }).waitFor({ timeout: 15_000 });
}

test.describe("Task Stop & Pause buttons", { tag: ["@task"] }, () => {
  test("Stop button completes a paused task", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigate(
      "stop task",
      stubScenario(emitText("Processing..."), onInput("next"), idle()),
    );
    await runScenarioToCompletion(page);

    // Task is now paused — Resume confirms paused state
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({
      timeout: 5_000,
    });

    // Click Stop (should kill active sessions + mark task complete)
    await page.getByRole("button", { name: "Stop", exact: true }).click();

    // Task status should become complete
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 10_000 });

    // Delete button should be visible (complete state actions)
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("Resume is hidden while the session is alive (idle) (#1356)", async ({ stubTask }) => {
    const { page } = stubTask;

    // Scenario goes idle and waits — the session stays ALIVE (waiting_input),
    // it is not terminated, so the task shows as paused with the input box open.
    await stubTask.createAndNavigate("pause task", stubScenario(emitText("Working..."), idle()));

    // Start the task — the scenario transitions to idle, causing paused state.
    await page.getByTestId("task-header-start").click();
    await page.locator('textarea[placeholder="Type a message..."]').waitFor({ timeout: 15_000 });
    await expect(page.locator('[data-testid="task-status"]')).toContainText("paused", {
      timeout: 15_000,
    });

    // The session is idle (alive), so Resume would be a silent no-op — it must
    // be hidden. Stop and Delete remain available.
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  });

  test("paused task can be resumed", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigate(
      "resume task",
      stubScenario(emitText("Processing..."), onInput("next"), idle()),
    );
    await runScenarioToCompletion(page);

    // Task is paused — Resume button should be visible
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible({
      timeout: 5_000,
    });

    // Resume the task
    await page.getByRole("button", { name: "Resume", exact: true }).click();

    // Task should go back to working/paused — Stop button reappears
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});
