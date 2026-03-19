import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTask,
  getProjectId,
  getTaskId,
  createTaskViaWs,
  navigateToTask,
  patchWsForStubRuntime,
  sendWsAndWaitFor,
  sendWsAndWaitForError,
} from "./helpers.js";

test.describe("Error States", () => {
  test("create_task with missing projectId succeeds (root task)", async ({ appPage }) => {
    const page = appPage;

    const result = await sendWsAndWaitFor(page, {
      type: "create_task",
      payload: { title: "orphan-task" },
    }, "task_created");

    expect(result.payload?.task?.title).toBe("orphan-task");
  });

  test("create_task with missing title returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitFor(page, {
      type: "create_task",
      payload: { title: "" },
    }, "create_task_error");

    expect(error.payload?.message).toContain("required");
  });

  test("create_task with non-existent project returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitFor(page, {
      type: "create_task",
      payload: { projectId: "does-not-exist-999", title: "ghost-task" },
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

    // Create project with a blocker and a dependent task
    await createProject(page, "err-deps");
    await createTask(page, "err-deps", "err-blocker", "test-local");

    const projectId = await getProjectId(page, "err-deps");
    const blockerId = await getTaskId(page, projectId, "err-blocker");

    const dependentTask = await createTaskViaWs(page, projectId, "err-blocked", {
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

    // Create project and task, start it
    await createProject(page, "err-running");
    await createTask(page, "err-running", "err-run-task", "test-local");
    await navigateToTask(page, "err-run-task");

    await patchWsForStubRuntime(page);
    await page.locator("button", { hasText: "Start" }).click();

    // Wait for task to be in_progress
    await page.locator('input[placeholder="Type a message..."]').waitFor({ timeout: 15_000 });

    // Get taskId and try to start again via WS
    const projectId = await getProjectId(page, "err-running");
    const taskId = await getTaskId(page, projectId, "err-run-task");

    const error = await sendWsAndWaitForError(page, {
      type: "start_task",
      payload: { taskId },
    });

    expect(error.payload?.message).toContain("cannot be started");
  });

  test("post_finding with missing title returns error", async ({ appPage }) => {
    const page = appPage;

    await createProject(page, "err-finding");
    const projectId = await getProjectId(page, "err-finding");

    const error = await sendWsAndWaitForError(page, {
      type: "post_finding",
      payload: { projectId, title: "" },
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

  test("create_project with empty name returns error", async ({ appPage }) => {
    const page = appPage;

    const error = await sendWsAndWaitForError(page, {
      type: "create_project",
      payload: { name: "" },
    });

    expect(error.payload?.message).toContain("required");
  });
});
