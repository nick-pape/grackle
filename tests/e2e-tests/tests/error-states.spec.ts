import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  getWorkspaceId,
  getTaskId,
  navigateToTask,
  patchWsForStubRuntime,
  sendWsAndWaitForError,
} from "./helpers.js";

// Pure protocol error tests (missing fields, non-existent IDs, dependency checks)
// have been migrated to packages/server/src/grpc-error-states.test.ts as integration tests.

test.describe("Error States — UI", { tag: ["@error"] }, () => {
  test("start_task on already-running task returns error", async ({ appPage }) => {
    const page = appPage;

    // Create workspace and task, start it
    await createWorkspace(page, "err-running");
    await createTask(page, "err-running", "err-run-task", "test-local");
    await navigateToTask(page, "err-run-task");

    await patchWsForStubRuntime(page);
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for task to be in_progress
    await page.locator('input[placeholder="Type a message..."]').waitFor({ timeout: 15_000 });

    // Get taskId and try to start again via WS
    const workspaceId = await getWorkspaceId(page, "err-running");
    const taskId = await getTaskId(page, workspaceId, "err-run-task");

    const error = await sendWsAndWaitForError(page, {
      type: "start_task",
      payload: { taskId },
    });

    expect(error.payload?.message).toContain("cannot be started");
  });
});
