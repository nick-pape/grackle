import { test, expect } from "./fixtures.js";
import {
  createProject,
  createTaskViaWs,
  getProjectId,
  sendWsAndWaitFor,
  sendWsMessage,
} from "./helpers.js";

/**
 * Helper: start a task via WS and return its session ID from the task.started event.
 */
async function startTaskAndGetSessionId(
  page: import("@playwright/test").Page,
  taskId: string,
): Promise<string> {
  const resp = await sendWsAndWaitFor(
    page,
    {
      type: "start_task",
      payload: { taskId, personaId: "stub", environmentId: "test-local" },
    },
    "task.started",
    30_000,
  );
  const sessionId = resp.payload?.sessionId as string;
  if (!sessionId) {
    throw new Error(`No sessionId in task.started event for task ${taskId}`);
  }
  return sessionId;
}

/**
 * Helper: poll session events until a status event with the target status appears.
 */
async function waitForSessionStatus(
  page: import("@playwright/test").Page,
  sessionId: string,
  targetStatus: string,
  timeoutMs: number = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await sendWsAndWaitFor(
      page,
      { type: "get_session_events", payload: { sessionId } },
      "session_events",
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (resp.payload?.events || []) as any[];
    const hasStatus = events.some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.eventType === "status" && e.content === targetStatus,
    );
    if (hasStatus) return;
    await page.waitForTimeout(500);
  }
  throw new Error(`Session ${sessionId} did not reach status "${targetStatus}" within ${timeoutMs}ms`);
}

/**
 * Helper: poll session events until a text event containing the pattern appears.
 * Returns the matching event content, or throws on timeout.
 */
async function waitForSessionText(
  page: import("@playwright/test").Page,
  sessionId: string,
  pattern: string,
  timeoutMs: number = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await sendWsAndWaitFor(
      page,
      { type: "get_session_events", payload: { sessionId } },
      "session_events",
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (resp.payload?.events || []) as any[];
    const match = events.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => typeof e.content === "string" && e.content.includes(pattern),
    );
    if (match) return match.content as string;
    await page.waitForTimeout(500);
  }
  throw new Error(`Session ${sessionId} events never contained "${pattern}" within ${timeoutMs}ms`);
}

test.describe("SIGCHLD — child completion notification", () => {
  test("parent receives SIGCHLD when child task goes idle", async ({ appPage: page }) => {
    // 1. Create project
    await createProject(page, "SIGCHLD Test");
    const projectId = await getProjectId(page, "SIGCHLD Test");

    // 2. Create parent task (canDecompose = true)
    const parentTask = await createTaskViaWs(page, projectId, "Parent Orchestrator", {
      canDecompose: true,
      environmentId: "test-local",
    });
    const parentTaskId = parentTask.id as string;

    // 3. Create child task under parent
    const childTask = await createTaskViaWs(page, projectId, "Child Worker", {
      parentTaskId,
      environmentId: "test-local",
    });
    const childTaskId = childTask.id as string;

    // 4. Start parent task → wait for IDLE (waiting_input)
    const parentSessionId = await startTaskAndGetSessionId(page, parentTaskId);
    await waitForSessionStatus(page, parentSessionId, "waiting_input");

    // 5. Start child task → it works, goes idle → SIGCHLD fires immediately
    const childSessionId = await startTaskAndGetSessionId(page, childTaskId);
    await waitForSessionStatus(page, childSessionId, "waiting_input");

    // 6. SIGCHLD is delivered to parent when child goes idle.
    //    Stub runtime echoes the signal as "You said: [SIGCHLD] ..."
    const sigchldContent = await waitForSessionText(
      page,
      parentSessionId,
      "[SIGCHLD]",
      30_000,
    );
    expect(sigchldContent).toContain("Child Worker");
    expect(sigchldContent).toContain("finished working");

    // Cleanup: complete the child session so it frees the environment for subsequent tests
    await sendWsMessage(page, {
      type: "send_input",
      payload: { sessionId: childSessionId, text: "continue" },
    });
    await waitForSessionStatus(page, childSessionId, "completed");
  });

  test("SIGCHLD delivered after parent session reanimated", async ({ appPage: page }) => {
    // 1. Create project
    await createProject(page, "SIGCHLD Reanimate");
    const projectId = await getProjectId(page, "SIGCHLD Reanimate");

    // 2. Create parent task (canDecompose = true)
    const parentTask = await createTaskViaWs(page, projectId, "Parent Reanimate", {
      canDecompose: true,
      environmentId: "test-local",
    });
    const parentTaskId = parentTask.id as string;

    // 3. Create child task under parent
    const childTask = await createTaskViaWs(page, projectId, "Child For Reanimate", {
      parentTaskId,
      environmentId: "test-local",
    });
    const childTaskId = childTask.id as string;

    // 4. Start parent → IDLE → send "continue" to complete it (make it dead)
    const parentSessionId = await startTaskAndGetSessionId(page, parentTaskId);
    await waitForSessionStatus(page, parentSessionId, "waiting_input");
    await sendWsMessage(page, {
      type: "send_input",
      payload: { sessionId: parentSessionId, text: "continue" },
    });
    await waitForSessionStatus(page, parentSessionId, "completed");

    // 5. Start child → idle (SIGCHLD fires but reanimate fails: env busy).
    //    Send "continue" → child completes, freeing the env.
    //    SIGCHLD fires again for "completed" (dedup allows retry after failure).
    //    This time reanimate succeeds.
    const childSessionId = await startTaskAndGetSessionId(page, childTaskId);
    await waitForSessionStatus(page, childSessionId, "waiting_input");
    await sendWsMessage(page, {
      type: "send_input",
      payload: { sessionId: childSessionId, text: "continue" },
    });
    await waitForSessionStatus(page, childSessionId, "completed");

    // 6. SIGCHLD triggers reanimate of parent session.
    //    The reanimated session echoes "[SIGCHLD]..." in its text events.
    const sigchldContent = await waitForSessionText(
      page,
      parentSessionId,
      "[SIGCHLD]",
      30_000,
    );
    expect(sigchldContent).toContain("Child For Reanimate");
    expect(sigchldContent).toContain("completed");
  });
});
