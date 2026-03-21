import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTask,
  getWorkspaceId,
  getTaskId,
  createTaskViaWs,
  navigateToTask,
  patchWsForStubRuntime,
  sendWsAndWaitFor,
  sendWsAndWaitForError,
} from "./helpers.js";

test.describe("Error States", { tag: ["@error"] }, () => {
  test("create_task with missing workspaceId succeeds (root task)", async ({ appPage }) => {
    const page = appPage;

    const result = await sendWsAndWaitFor(page, {
      type: "create_task",
      payload: { title: "orphan-task" },
    }, "task.created");

    expect(result.payload?.taskId).toBeTruthy();
  });

  test("create_task with missing title returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitFor(page, {
      type: "create_task",
      payload: { title: "" },
    }, "create_task_error");

    expect(error.payload?.message).toContain("required");
  });

  test("create_task with non-existent workspace returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitFor(page, {
      type: "create_task",
      payload: { workspaceId: "does-not-exist-999", title: "ghost-task" },
    }, "create_task_error");

    expect(error.payload?.message).toContain("not found");
  });

  test("start_task on non-existent task returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitForError(page, {
      type: "start_task",
      payload: { taskId: "nonexistent-task-id" },
    });

    expect(error.payload?.message).toContain("not found");
  });

  test("start_task on task with unmet dependencies returns error", async ({ appPage }) => {
    const page = appPage;

    // Create workspace with a blocker and a dependent task
    await createWorkspace(page, "err-deps");
    await createTask(page, "err-deps", "err-blocker", "test-local");

    const workspaceId = await getWorkspaceId(page, "err-deps");
    const blockerId = await getTaskId(page, workspaceId, "err-blocker");

    const dependentTask = await createTaskViaWs(page, workspaceId, "err-blocked", {
      environmentId: "test-local",
      dependsOn: [blockerId],
    });

    // Try to start the blocked task
    const error = await sendWsAndWaitForError(page, {
      type: "start_task",
      payload: { taskId: dependentTask.id },
    });

    expect(error.payload?.message).toContain("unmet dependencies");
  });

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

  test("post_finding with missing title returns error", async ({ appPage }) => {
    const page = appPage;

    await createWorkspace(page, "err-finding");
    const workspaceId = await getWorkspaceId(page, "err-finding");

    const error = await sendWsAndWaitForError(page, {
      type: "post_finding",
      payload: { workspaceId: workspaceId, title: "" },
    });

    expect(error.payload?.message).toContain("required");
  });

  test("spawn with missing environmentId returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitForError(page, {
      type: "spawn",
      payload: { environmentId: "", prompt: "hello" },
    });

    expect(error.payload?.message).toContain("required");
  });

  test("create_workspace with empty name returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitForError(page, {
      type: "create_workspace",
      payload: { name: "" },
    });

    expect(error.payload?.message).toContain("required");
  });
});
