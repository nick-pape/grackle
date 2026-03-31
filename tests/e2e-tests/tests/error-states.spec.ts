import { test, expect } from "./fixtures.js";
import {
  createTask,
  getWorkspaceId,
  getTaskId,
  navigateToTask,
} from "./helpers.js";

// Pure protocol error tests (missing fields, non-existent IDs, dependency checks)
// have been migrated to packages/server/src/grpc-error-states.test.ts as integration tests.

test.describe("Error States — UI", { tag: ["@error"] }, () => {
  test("start_task on already-running task returns error", async ({ stubTask }) => {
    const { page, client, workspaceName } = stubTask;

    // Create task and start it (stub runtime patched by fixture)
    await createTask(client, workspaceName, "err-run-task", "test-local");
    await navigateToTask(page, "err-run-task");

    await page.locator("button", { hasText: "Start" }).click();

    // Wait for task to be in_progress
    await page.locator('input[placeholder="Type a message..."]').waitFor({ timeout: 15_000 });

    // Get taskId and try to start again via RPC
    const workspaceId = await getWorkspaceId(client, workspaceName);
    const taskId = await getTaskId(client, workspaceId, "err-run-task");

    let error: Error | undefined;
    try {
      await client.orchestration.startTask({ taskId });
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).toContain("cannot be started");
  });
});
