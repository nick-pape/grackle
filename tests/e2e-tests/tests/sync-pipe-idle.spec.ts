/**
 * E2E test for #824: sync pipe delivery when child goes idle (waiting_input)
 * instead of reaching a terminal status.
 *
 * Uses the stub runtime to simulate a child that emits output then goes idle
 * without calling task_complete. Verifies that:
 * - waitForPipe unblocks when the child goes idle
 * - The child is auto-stopped after the sync pipe is consumed
 */
import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import { stubScenario, emitText, idle, createWorkspace } from "./helpers.js";

/**
 * Poll getSession until the session reaches the target status.
 */
async function waitForSessionStatus(
  client: GrackleClient,
  sessionId: string,
  targetStatus: string,
  timeoutMs: number = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await client.getSession({ id: sessionId });
    if (resp.status === targetStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Session ${sessionId} did not reach status "${targetStatus}" within ${timeoutMs}ms`);
}

test.describe("sync pipe idle delivery (#824)", { tag: ["@session"] }, () => {
  // Kill any stale active sessions before each test to free the environment.
  test.beforeEach(async ({ grackle: { client } }) => {
    const sessionsResp = await client.listSessions({});
    const all = sessionsResp.sessions as Array<{ id: string; status: string }>;
    const active = all.filter((s) => ["idle", "running", "pending"].includes(s.status));
    for (const s of active) {
      await client.killAgent({ id: s.id });
    }
    if (active.length > 0) {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const recheck = await client.listSessions({});
        const remaining = recheck.sessions as Array<{ status: string }>;
        if (!remaining.some((s) => ["idle", "running", "pending"].includes(s.status))) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  });

  test("waitForPipe unblocks when child goes idle instead of terminal", async ({ grackle: { client } }) => {
    // 1. Create workspace
    await createWorkspace(client, "sync-pipe-test");

    // 2. Spawn a parent session that stays idle (it will call waitForPipe)
    const parentScenario = stubScenario(idle());
    const parentSession = await client.spawnAgent({
      environmentId: "test-local",
      prompt: JSON.stringify(parentScenario),
      personaId: "stub",
    });
    const parentSessionId = parentSession.id;
    await waitForSessionStatus(client, parentSessionId, "idle");

    // 3. Spawn a child with pipe:"sync" — child emits text then goes idle
    //    (simulating an agent that finishes work but doesn't call task_complete)
    const childScenario = stubScenario(
      emitText("Here is the result of my work."),
      idle(),
    );
    const childSession = await client.spawnAgent({
      environmentId: "test-local",
      prompt: JSON.stringify(childScenario),
      personaId: "stub",
      pipe: "sync",
      parentSessionId,
    });
    const childSessionId = childSession.id;
    const pipeFd = childSession.pipeFd;
    expect(pipeFd).toBeGreaterThan(0);

    // 4. waitForPipe should unblock when the child goes idle (not hang forever)
    //    This is the core assertion for #824 — before the fix, this would deadlock.
    const pipeResult = await client.waitForPipe({
      sessionId: parentSessionId,
      fd: pipeFd,
    });

    // 5. The pipe result should contain the child's output
    expect(pipeResult.content).toContain("finished (idle)");
    expect(pipeResult.senderSessionId).toBe(childSessionId);

    // 6. After sync pipe consumption, the child should be auto-stopped
    //    (lifecycle stream cleanup orphans the child → auto-stop)
    await waitForSessionStatus(client, childSessionId, "stopped", 10_000);

    // Cleanup: kill the parent
    await client.killAgent({ id: parentSessionId });
    await waitForSessionStatus(client, parentSessionId, "stopped");
  });

  test("waitForPipe still works for normal terminal status (completed)", async ({ grackle: { client } }) => {
    // Ensure the existing behavior (child completes normally) still works.
    await createWorkspace(client, "sync-pipe-test-complete");

    // Parent goes idle
    const parentSession = await client.spawnAgent({
      environmentId: "test-local",
      prompt: JSON.stringify(stubScenario(idle())),
      personaId: "stub",
    });
    const parentSessionId = parentSession.id;
    await waitForSessionStatus(client, parentSessionId, "idle");

    // Child emits text and completes (no idle step — scenario ends → "completed")
    const childSession = await client.spawnAgent({
      environmentId: "test-local",
      prompt: JSON.stringify(stubScenario(emitText("Done!"))),
      personaId: "stub",
      pipe: "sync",
      parentSessionId,
    });
    const pipeFd = childSession.pipeFd;
    expect(pipeFd).toBeGreaterThan(0);

    const pipeResult = await client.waitForPipe({
      sessionId: parentSessionId,
      fd: pipeFd,
    });

    expect(pipeResult.content).toContain("completed");
    expect(pipeResult.senderSessionId).toBe(childSession.id);

    // Child should also be stopped after cleanup
    await waitForSessionStatus(client, childSession.id, "stopped", 10_000);

    // Cleanup
    await client.killAgent({ id: parentSessionId });
    await waitForSessionStatus(client, parentSessionId, "stopped");
  });
});
