import { test, expect } from "./fixtures.js";
import { stubScenario, emitText, idle } from "./helpers.js";

/**
 * Drive a task to a live, idle (awaiting-input) state: the scenario emits some
 * text then goes idle. The session stays ALIVE (waiting_input) — it is not
 * terminated — so the task shows as `paused` with the input box available.
 */
async function startAndReachIdle(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("task-header-start").click();
  // The chat input appears once the session is idle and accepting input.
  await page.locator('textarea[placeholder="Type a message..."]').waitFor({ timeout: 15_000 });
  await expect(page.locator('[data-testid="task-status"]')).toContainText("paused", {
    timeout: 15_000,
  });
}

test.describe("Task Stop / Resume semantics (#1356)", { tag: ["@task"] }, () => {
  test("Resume is hidden while the session is alive (idle)", async ({ stubTask }) => {
    const { page } = stubTask;

    // Scenario goes idle and waits — the session stays alive.
    await stubTask.createAndNavigate("idle task", stubScenario(emitText("Working..."), idle()));
    await startAndReachIdle(page);

    // The session is idle (alive), so Resume would be a silent no-op — it must
    // be hidden. Stop and Delete remain available.
    await expect(page.getByTestId("task-action-stop")).toBeVisible();
    await expect(page.getByTestId("task-action-resume")).toBeHidden();
    await expect(page.getByTestId("task-action-delete")).toBeVisible();
  });

  test("Stop pauses an active task (does NOT complete it) and makes it resumable", async ({
    stubTask,
  }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigate("stop task", stubScenario(emitText("Working..."), idle()));
    await startAndReachIdle(page);

    // Stop terminates the live session.
    await page.getByTestId("task-action-stop").click();

    // The task stays paused — it is NOT marked complete.
    await expect(page.locator('[data-testid="task-status"]')).toContainText("paused", {
      timeout: 10_000,
    });
    await expect(page.getByText("Task completed")).not.toBeVisible();

    // Now that the session is stopped, the task is resumable: Resume appears.
    await expect(page.getByTestId("task-action-resume")).toBeVisible({ timeout: 10_000 });
  });

  test("a stopped task can be resumed", async ({ stubTask }) => {
    const { page } = stubTask;

    await stubTask.createAndNavigate("resume task", stubScenario(emitText("Working..."), idle()));
    await startAndReachIdle(page);

    // Stop to reach a genuinely stopped (resumable) session.
    await page.getByTestId("task-action-stop").click();
    await expect(page.getByTestId("task-action-resume")).toBeVisible({ timeout: 10_000 });

    // Resume reanimates the session — the task becomes active again.
    await page.getByTestId("task-action-resume").click();
    await expect(page.locator('[data-testid="task-status"]')).toContainText(/working|paused/, {
      timeout: 15_000,
    });
  });
});
