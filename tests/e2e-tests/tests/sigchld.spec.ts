import { test, expect } from "./fixtures.js";
import {
  createWorkspace,
  createTaskViaWs,
  getWorkspaceId,
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
 * Helper: poll list_sessions until the session reaches the target status.
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
      { type: "list_sessions", payload: {} },
      "sessions",
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessions = (resp.payload?.sessions || []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessions.find((s: any) => s.id === sessionId);
    if (session && session.status === targetStatus) {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Session ${sessionId} did not reach status "${targetStatus}" within ${timeoutMs}ms`);
}

/**
 * Helper: poll session events until a non-system-context event whose `content`
 * includes the given pattern appears (catches user_input, text, signal, and
 * other content-bearing events, but skips the system context event which
 * contains documentation that could match patterns like "[SIGCHLD]").
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
      (e: any) => {
        if (typeof e.content !== "string" || !e.content.includes(pattern)) {
          return false;
        }
        // Skip system context events — their content contains documentation
        // that can false-match patterns like "[SIGCHLD]"
        if (e.raw) {
          try {
            const raw = JSON.parse(e.raw) as Record<string, unknown>;
            if (raw.systemContext === true) {
              return false;
            }
          } catch { /* not JSON, include it */ }
        }
        return true;
      },
    );
    if (match) return match.content as string;
    await page.waitForTimeout(500);
  }
  throw new Error(`Session ${sessionId} events never contained "${pattern}" within ${timeoutMs}ms`);
}

test.describe("SIGCHLD — child completion notification", { tag: ["@error"] }, () => {
  test("parent receives SIGCHLD when child task goes idle", async ({ appPage: page }) => {
    // 1. Create workspace
    await createWorkspace(page, "SIGCHLD Test");
    const workspaceId = await getWorkspaceId(page, "SIGCHLD Test");

    // 2. Create parent task (canDecompose = true)
    const parentTask = await createTaskViaWs(page, workspaceId, "Parent Orchestrator", {
      canDecompose: true,
      environmentId: "test-local",
    });
    const parentTaskId = parentTask.id as string;

    // 3. Create child task under parent
    const childTask = await createTaskViaWs(page, workspaceId, "Child Worker", {
      parentTaskId,
      environmentId: "test-local",
    });
    const childTaskId = childTask.id as string;

    // 4. Start parent task → wait for IDLE (waiting_input)
    const parentSessionId = await startTaskAndGetSessionId(page, parentTaskId);
    await waitForSessionStatus(page, parentSessionId, "idle");

    // 5. Start child task → it works, goes idle → SIGCHLD fires immediately
    const childSessionId = await startTaskAndGetSessionId(page, childTaskId);
    await waitForSessionStatus(page, childSessionId, "idle");

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

    // Cleanup: kill both sessions to free the environment for subsequent tests
    await sendWsMessage(page, {
      type: "kill",
      payload: { sessionId: childSessionId },
    });
    await waitForSessionStatus(page, childSessionId, "stopped");
    await sendWsMessage(page, {
      type: "kill",
      payload: { sessionId: parentSessionId },
    });
    await waitForSessionStatus(page, parentSessionId, "stopped");
  });

  test("SIGCHLD delivered after parent session reanimated", { timeout: 90_000 }, async ({ appPage: page }) => {
    // 1. Create workspace
    await createWorkspace(page, "SIGCHLD Reanimate");
    const workspaceId = await getWorkspaceId(page, "SIGCHLD Reanimate");

    // 2. Create parent task (canDecompose = true)
    const parentTask = await createTaskViaWs(page, workspaceId, "Parent Reanimate", {
      canDecompose: true,
      environmentId: "test-local",
    });
    const parentTaskId = parentTask.id as string;

    // 3. Create child task under parent
    const childTask = await createTaskViaWs(page, workspaceId, "Child For Reanimate", {
      parentTaskId,
      environmentId: "test-local",
    });
    const childTaskId = childTask.id as string;

    // 4. Start parent → IDLE → kill it to make it dead (STOPPED)
    const parentSessionId = await startTaskAndGetSessionId(page, parentTaskId);
    await waitForSessionStatus(page, parentSessionId, "idle");
    await sendWsMessage(page, {
      type: "kill",
      payload: { sessionId: parentSessionId },
    });
    await waitForSessionStatus(page, parentSessionId, "stopped");

    // 5. Start child → idle (SIGCHLD fires but reanimate fails: env busy).
    //    Kill child → STOPPED, freeing the env.
    //    SIGCHLD fires again for "killed" (dedup allows retry after failure).
    //    This time reanimate succeeds.
    const childSessionId = await startTaskAndGetSessionId(page, childTaskId);
    await waitForSessionStatus(page, childSessionId, "idle");
    await sendWsMessage(page, {
      type: "kill",
      payload: { sessionId: childSessionId },
    });
    await waitForSessionStatus(page, childSessionId, "stopped");

    // 6. SIGCHLD triggers reanimate of parent session.
    //    The reanimated session echoes "[SIGCHLD]..." in its text events.
    //    Allow extra time for the async reanimate chain to complete.
    const sigchldContent = await waitForSessionText(
      page,
      parentSessionId,
      "[SIGCHLD]",
      60_000,
    );
    expect(sigchldContent).toContain("Child For Reanimate");
    expect(sigchldContent).toContain("was killed");
  });
});
