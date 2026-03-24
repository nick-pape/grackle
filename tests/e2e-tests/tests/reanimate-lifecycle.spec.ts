/**
 * E2E test for issue #828: lifecycle stream must be recreated on reanimate.
 *
 * Verifies the full cycle: start task → stop task → resume task → complete task
 * → session auto-stops via FD-based orphan cascade. Without the fix, the
 * reanimated session would stay idle forever after task completion because
 * the lifecycle stream was not recreated.
 */
import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import {
  createWorkspace,
  createTaskDirect,
  getWorkspaceId,
  stubScenario,
  emitText,
  idle,
  onInput,
} from "./helpers.js";

/**
 * Helper: start a task via RPC and return its session ID.
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

test.describe("Reanimate lifecycle stream (#828)", { tag: ["@task"] }, () => {
  test("resumeTask recreates lifecycle stream — completeTask cascades to stop session", async ({ grackle: { client } }) => {
    test.setTimeout(60_000);

    // 1. Create workspace and task with a stub scenario that goes idle
    const scenario = stubScenario(
      emitText("Working..."),
      onInput("next"),
      idle(),
    );
    await createWorkspace(client, "Lifecycle Reanimate");
    const workspaceId = await getWorkspaceId(client, "Lifecycle Reanimate");
    const task = await createTaskDirect(client, workspaceId, "Reanimate Test", {
      description: JSON.stringify(scenario),
      environmentId: "test-local",
    });
    const taskId = task.id as string;

    // 2. Start task → session reaches idle
    const sessionId = await startTaskAndGetSessionId(client, taskId);
    await waitForSessionStatus(client, sessionId, "idle");

    // 3. Stop task → session killed, lifecycle stream deleted
    await client.stopTask({ id: taskId });
    await waitForSessionStatus(client, sessionId, "stopped");

    // 4. Resume task → session reanimated (lifecycle stream recreated by fix)
    const resumeResult = await client.resumeTask({ id: taskId });
    expect(resumeResult.id).toBeTruthy();
    await waitForSessionStatus(client, sessionId, "idle");

    // 5. Complete task → lifecycle stream cleanup triggers orphan cascade
    //    → session should auto-stop. This is the core assertion for #828:
    //    without ensureLifecycleStream, the session would stay idle forever.
    await client.completeTask({ id: taskId });
    await waitForSessionStatus(client, sessionId, "stopped", 15_000);

    // 6. Verify task is complete and session is stopped with correct reason
    const sessionsResp = await client.listSessions({});
    const session = sessionsResp.sessions.find((s) => s.id === sessionId);
    expect(session?.status).toBe("stopped");
  });
});
