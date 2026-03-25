import { test, expect } from "./fixtures.js";
import { installWsTracker, injectWsMessage } from "./helpers.js";

/**
 * Tests that task state changes trigger toast notifications in the web UI.
 *
 * Uses WebSocket injection (same pattern as environment-status-broadcast.spec.ts)
 * to simulate task list updates without needing a real task runtime.
 *
 * Toast messages are generic (no resource names) — see App.tsx comment.
 */

/** Build a full task payload object for WS injection. */
function makeInjectedTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "toast-test-task",
    workspaceId: "",
    title: "Toast Test Task",
    description: "",
    status: "not_started",
    branch: "",
    latestSessionId: "",
    dependsOn: [],
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    parentTaskId: "",
    depth: 0,
    childTaskIds: [],
    canDecompose: false,
    defaultPersonaId: "",
    ...overrides,
  };
}

/** Inject a task list via WebSocket. */
async function injectTaskList(
  page: import("@playwright/test").Page,
  tasks: Record<string, unknown>[],
): Promise<void> {
  await injectWsMessage(page, {
    type: "tasks",
    payload: { workspaceId: "", tasks },
  });
}

test.describe("Task State Toast Notifications", { tag: ["@task"] }, () => {
  test("injected task status change to working shows started toast", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Inject task in initial state
    await injectTaskList(page, [makeInjectedTask({ status: "not_started" })]);

    // Transition to working
    await injectTaskList(page, [makeInjectedTask({ status: "working" })]);

    // Generic started toast should appear
    await expect(page.getByText("Task started")).toBeVisible({ timeout: 5_000 });
  });

  test("injected task completion shows completed toast", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Inject task in working state
    await injectTaskList(page, [makeInjectedTask({ status: "working" })]);

    // Transition to complete
    await injectTaskList(page, [makeInjectedTask({ status: "complete" })]);

    // Generic completed toast should appear
    await expect(page.getByText("Task completed")).toBeVisible({ timeout: 5_000 });
  });

  test("injected task failure shows failed toast", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Inject task in working state
    await injectTaskList(page, [makeInjectedTask({ status: "working" })]);

    // Transition to failed
    await injectTaskList(page, [makeInjectedTask({ status: "failed" })]);

    // Generic failed toast should appear
    await expect(page.getByText("Task failed")).toBeVisible({ timeout: 5_000 });
  });

  test("injected task removal shows deleted toast", async ({ page }) => {
    await installWsTracker(page);
    await page.goto("/");
    await page.waitForFunction(
      () => document.body.innerText.includes("Connected"),
      { timeout: 10_000 },
    );

    // Inject a task
    await injectTaskList(page, [makeInjectedTask({ status: "working" })]);

    // Remove the task (inject empty list)
    await injectTaskList(page, []);

    // Generic deleted toast should appear
    await expect(page.getByText("Task deleted")).toBeVisible({ timeout: 5_000 });
  });
});
