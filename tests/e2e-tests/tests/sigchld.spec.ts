import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import {
  createWorkspace,
  createTaskDirect,
  getWorkspaceId,
} from "./helpers.js";

/**
 * Helper: start a task via RPC and return its session ID from the response.
 */
async function startTaskAndGetSessionId(
  client: GrackleClient,
  taskId: string,
): Promise<string> {
  const resp = await client.startTask({
    taskId,
    personaId: "stub",
    environmentId: "test-local",
  });
  const sessionId = resp.id;
  if (!sessionId) {
    throw new Error(`No session ID in startTask response for task ${taskId}`);
  }
  return sessionId;
}

/**
 * Helper: poll listSessions until the session reaches the target status.
 */
async function waitForSessionStatus(
  client: GrackleClient,
  sessionId: string,
  targetStatus: string,
  timeoutMs: number = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await client.listSessions({});
    const sessions = resp.sessions;
    const session = sessions.find((s) => s.id === sessionId);
    if (session && session.status === targetStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
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
  client: GrackleClient,
  sessionId: string,
  pattern: string,
  timeoutMs: number = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await client.getSessionEvents({ id: sessionId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (resp.events || []) as any[];
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Session ${sessionId} events never contained "${pattern}" within ${timeoutMs}ms`);
}

test.describe("SIGCHLD — child completion notification", { tag: ["@error"] }, () => {
  // Kill any stale active sessions on test-local so the environment is free.
  // Without this, sessions from earlier tests (or session recovery) can block
  // reanimateAgent with "Environment already has active session".
  test.beforeEach(async ({ grackle: { client } }) => {
    const sessionsResp = await client.listSessions({});
    const all = sessionsResp.sessions as Array<{ id: string; status: string }>;
    const active = all.filter((s) => s.status === "idle" || s.status === "running" || s.status === "pending");
    for (const s of active) {
      await client.killAgent({ id: s.id });
    }
    if (active.length > 0) {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const recheck = await client.listSessions({});
        const remaining = recheck.sessions as Array<{ status: string }>;
        if (!remaining.some((s) => s.status === "idle" || s.status === "running" || s.status === "pending")) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  });

  test("parent receives SIGCHLD when child task goes idle", async ({ grackle: { client } }) => {
    // 1. Create workspace
    await createWorkspace(client, "SIGCHLD Test");
    const workspaceId = await getWorkspaceId(client, "SIGCHLD Test");

    // 2. Create parent task (canDecompose = true)
    const parentTask = await createTaskDirect(client, workspaceId, "Parent Orchestrator", {
      canDecompose: true,
      environmentId: "test-local",
    });
    const parentTaskId = parentTask.id as string;

    // 3. Create child task under parent
    const childTask = await createTaskDirect(client, workspaceId, "Child Worker", {
      parentTaskId,
      environmentId: "test-local",
    });
    const childTaskId = childTask.id as string;

    // 4. Start parent task → wait for IDLE (waiting_input)
    const parentSessionId = await startTaskAndGetSessionId(client, parentTaskId);
    await waitForSessionStatus(client, parentSessionId, "idle");

    // 5. Start child task → it works, goes idle → SIGCHLD fires immediately
    const childSessionId = await startTaskAndGetSessionId(client, childTaskId);
    await waitForSessionStatus(client, childSessionId, "idle");

    // 6. SIGCHLD is delivered to parent when child goes idle.
    //    Stub runtime echoes the signal as "You said: [SIGCHLD] ..."
    const sigchldContent = await waitForSessionText(
      client,
      parentSessionId,
      "[SIGCHLD]",
      30_000,
    );
    expect(sigchldContent).toContain("Child Worker");
    expect(sigchldContent).toContain("finished working");

    // Cleanup: kill both sessions to free the environment for subsequent tests
    await client.killAgent({ id: childSessionId });
    await waitForSessionStatus(client, childSessionId, "stopped");
    await client.killAgent({ id: parentSessionId });
    await waitForSessionStatus(client, parentSessionId, "stopped");
  });

  test("SIGCHLD delivered after parent session reanimated", async ({ grackle: { client } }) => {
    test.setTimeout(90_000);

    // 1. Create workspace
    await createWorkspace(client, "SIGCHLD Reanimate");
    const workspaceId = await getWorkspaceId(client, "SIGCHLD Reanimate");

    // 2. Create parent task (canDecompose = true)
    const parentTask = await createTaskDirect(client, workspaceId, "Parent Reanimate", {
      canDecompose: true,
      environmentId: "test-local",
    });
    const parentTaskId = parentTask.id as string;

    // 3. Create child task under parent
    const childTask = await createTaskDirect(client, workspaceId, "Child For Reanimate", {
      parentTaskId,
      environmentId: "test-local",
    });
    const childTaskId = childTask.id as string;

    // 4. Start parent → IDLE → kill it to make it dead (STOPPED)
    const parentSessionId = await startTaskAndGetSessionId(client, parentTaskId);
    await waitForSessionStatus(client, parentSessionId, "idle");
    await client.killAgent({ id: parentSessionId });
    await waitForSessionStatus(client, parentSessionId, "stopped");

    // 5. Start child → idle (SIGCHLD fires but reanimate fails: env busy).
    //    Kill child → STOPPED, freeing the env.
    //    SIGCHLD fires again for "killed" (dedup allows retry after failure).
    //    This time reanimate succeeds.
    const childSessionId = await startTaskAndGetSessionId(client, childTaskId);
    await waitForSessionStatus(client, childSessionId, "idle");
    await client.killAgent({ id: childSessionId });
    await waitForSessionStatus(client, childSessionId, "stopped");

    // 6. SIGCHLD triggers reanimate of parent session.
    //    The reanimated session echoes "[SIGCHLD]..." in its text events.
    //    Allow extra time for the async reanimate chain to complete.
    const sigchldContent = await waitForSessionText(
      client,
      parentSessionId,
      "[SIGCHLD]",
      60_000,
    );
    expect(sigchldContent).toContain("Child For Reanimate");
    // The child's status label may vary (killed, finished working, etc.)
    // depending on session lifecycle timing. The key assertion is that
    // SIGCHLD was delivered with the child task name.
  });
});
