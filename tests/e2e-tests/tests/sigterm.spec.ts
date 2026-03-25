import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import {
  createWorkspace,
  createTaskDirect,
  getWorkspaceId,
  stubScenario,
  emitText,
  idle,
  createTaskWithScenario,
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
    const session = resp.sessions.find((s) => s.id === sessionId);
    if (session && session.status === targetStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Session ${sessionId} did not reach status "${targetStatus}" within ${timeoutMs}ms`);
}

/**
 * Helper: poll session events until a non-system-context event whose content
 * includes the given pattern appears. Returns the matching event content.
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
        // that can false-match patterns like "[SIGTERM]"
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

/**
 * Helper: get session by ID, returning the full session object with endReason.
 */
async function getSession(
  client: GrackleClient,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const resp = await client.getSession({ id: sessionId });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return resp as unknown as Record<string, any>;
}

test.describe("SIGTERM — graceful shutdown signal", { tag: ["@session"] }, () => {
  // Kill any stale active sessions on test-local so the environment is free.
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

  test("graceful kill delivers SIGTERM and session ends with terminated", async ({ grackle: { client } }) => {
    // 1. Create workspace + task with a scenario that goes idle once
    //    (after receiving SIGTERM input, the stub echoes it and completes)
    await createWorkspace(client, "SIGTERM Test");
    const workspaceId = await getWorkspaceId(client, "SIGTERM Test");
    const scenario = stubScenario(emitText("Working..."), idle());
    const task = await createTaskDirect(client, workspaceId, "SIGTERM Worker", {
      environmentId: "test-local",
      description: JSON.stringify(scenario),
    });
    const taskId = task.id as string;

    // 2. Start task → wait for IDLE
    const sessionId = await startTaskAndGetSessionId(client, taskId);
    await waitForSessionStatus(client, sessionId, "idle");

    // 3. Send graceful kill (SIGTERM)
    await client.killAgent({ id: sessionId, graceful: true });

    // 4. Verify [SIGTERM] signal was delivered and echoed by the stub runtime
    const sigtermContent = await waitForSessionText(client, sessionId, "[SIGTERM]", 30_000);
    expect(sigtermContent).toContain("[SIGTERM]");

    // 5. Session should eventually stop (stub processes the SIGTERM input and completes)
    await waitForSessionStatus(client, sessionId, "stopped");

    // 6. Verify endReason is "terminated" (not "completed")
    const session = await getSession(client, sessionId);
    expect(session.endReason).toBe("terminated");
  });

  test("hard kill (graceful=false) stops session immediately with killed", async ({ grackle: { client } }) => {
    // 1. Create workspace + task
    await createWorkspace(client, "SIGKILL Test");
    const workspaceId = await getWorkspaceId(client, "SIGKILL Test");
    const task = await createTaskDirect(client, workspaceId, "SIGKILL Worker", {
      environmentId: "test-local",
    });
    const taskId = task.id as string;

    // 2. Start task → wait for IDLE
    const sessionId = await startTaskAndGetSessionId(client, taskId);
    await waitForSessionStatus(client, sessionId, "idle");

    // 3. Send hard kill (SIGKILL)
    await client.killAgent({ id: sessionId, graceful: false });

    // 4. Session should be stopped immediately
    await waitForSessionStatus(client, sessionId, "stopped");

    // 5. Verify endReason is "killed"
    const session = await getSession(client, sessionId);
    expect(session.endReason).toBe("killed");
  });

  test("graceful kill on already-stopped session is a no-op", async ({ grackle: { client } }) => {
    // 1. Create workspace + task
    await createWorkspace(client, "SIGTERM Stopped");
    const workspaceId = await getWorkspaceId(client, "SIGTERM Stopped");
    const task = await createTaskDirect(client, workspaceId, "Already Stopped", {
      environmentId: "test-local",
    });
    const taskId = task.id as string;

    // 2. Start task → wait for IDLE → hard kill
    const sessionId = await startTaskAndGetSessionId(client, taskId);
    await waitForSessionStatus(client, sessionId, "idle");
    await client.killAgent({ id: sessionId, graceful: false });
    await waitForSessionStatus(client, sessionId, "stopped");

    // 3. Graceful kill on stopped session — should not throw, session stays killed
    // The handler skips SIGTERM delivery for terminal sessions and falls through to hard kill,
    // which is a no-op on already-stopped sessions.
    await client.killAgent({ id: sessionId, graceful: true });

    // 4. Verify session is still stopped with original endReason
    const session = await getSession(client, sessionId);
    expect(session.status).toBe("stopped");
    expect(session.endReason).toBe("killed");
  });
});
