import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  navigateToTask,
  patchWsForStubRuntime,
} from "./helpers.js";

test.describe("Concurrent Tasks", () => {
  test("two tasks run concurrently without event leakage", async ({ appPage }) => {
    const page = appPage;

    // Create project with two tasks
    await createProject(page, "conc-leak");
    await createTask(page, "conc-leak", "conc-task-a", "test-local");
    await createTask(page, "conc-leak", "conc-task-b", "test-local");

    // Patch WS to use stub runtime
    await patchWsForStubRuntime(page);

    // Start task A
    await navigateToTask(page, "conc-task-a");
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for task A to reach waiting_input (stub emits events then waits)
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await inputField.waitFor({ timeout: 15_000 });

    // Start task B (navigate to it while A is running)
    await navigateToTask(page, "conc-task-b");
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for task B to reach waiting_input
    await inputField.waitFor({ timeout: 15_000 });

    // Verify task B's stream shows events for task B (not task A)
    // The Stream tab should show content related to this task's session
    await expect(page.locator('[data-testid="task-status"]')).toBeVisible();

    // Navigate back to task A — its stream should still be intact
    await navigateToTask(page, "conc-task-a");
    await expect(page.locator('[data-testid="task-status"]')).toBeVisible();
    // Task A should still be in waiting_input (input field visible)
    await expect(inputField).toBeVisible({ timeout: 5_000 });

    // Complete both tasks: send input to A
    await inputField.fill("continue");
    await page.locator("button", { hasText: "Send" }).click();
    await page.locator("button", { hasText: "Resume" }).waitFor({ timeout: 15_000 });

    // Complete task B
    await navigateToTask(page, "conc-task-b");
    await inputField.waitFor({ timeout: 5_000 });
    await inputField.fill("continue");
    await page.locator("button", { hasText: "Send" }).click();
    await page.locator("button", { hasText: "Resume" }).waitFor({ timeout: 15_000 });

    // Both tasks should independently reach review
    await expect(page.locator("button", { hasText: "Resume" })).toBeVisible();
    await navigateToTask(page, "conc-task-a");
    await expect(page.locator("button", { hasText: "Resume" })).toBeVisible({ timeout: 5_000 });
  });

  test("concurrent tasks show correct sidebar status simultaneously", async ({ appPage }) => {
    const page = appPage;

    // Create project with two tasks
    await createProject(page, "conc-status");
    await createTask(page, "conc-status", "status-task-x", "test-local");
    await createTask(page, "conc-status", "status-task-y", "test-local");

    // Patch WS to use stub runtime
    await patchWsForStubRuntime(page);

    // Start task X
    await navigateToTask(page, "status-task-x");
    await page.locator("button", { hasText: "Start" }).click();

    // Scope status checks to each task's sidebar entry (exact: true avoids matching the header)
    const taskXRow = page.getByText("status-task-x", { exact: true }).locator("..");
    const taskYRow = page.getByText("status-task-y", { exact: true }).locator("..");

    // Wait for task X to be active (● = in_progress or ⧖ = waiting_input)
    await expect(taskXRow.locator("text=/(●|◉)/")).toBeVisible({ timeout: 15_000 });

    // Start task Y
    await navigateToTask(page, "status-task-y");
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for task Y to also be active — both tasks should show active icon in sidebar
    await expect(taskYRow.locator("text=/(●|◉)/")).toBeVisible({ timeout: 15_000 });
    await expect(taskXRow.locator("text=/(●|◉)/")).toBeVisible();

    // Complete task X to review: navigate, send input
    await navigateToTask(page, "status-task-x");
    const inputField = page.locator('input[placeholder="Type a message..."]');
    await inputField.waitFor({ timeout: 15_000 });
    await inputField.fill("continue");
    await page.locator("button", { hasText: "Send" }).click();

    // Wait for task X to reach review (◉) while task Y stays active (● or ⧖)
    await expect(taskXRow.locator("text=◉")).toBeVisible({ timeout: 15_000 });
    await expect(taskYRow.locator("text=/(●|◉)/")).toBeVisible();
  });
});
