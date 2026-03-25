import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import {
  createWorkspace,
  createTaskDirect,
  getWorkspaceId,
  stubScenario,
  emitMcpCall,
} from "./helpers.js";

/**
 * Helper: start a task via RPC with stub-mcp persona and return the session ID.
 */
async function startTaskStubMcp(
  client: GrackleClient,
  taskId: string,
): Promise<string> {
  const resp = await client.startTask({
    taskId,
    personaId: "stub-mcp",
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

test.describe("Workpad E2E", { tag: ["@task"] }, () => {
  // Kill any stale active sessions before each test to free the environment.
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

  test("agent writes workpad via MCP, persists on task", async ({ grackle: { client } }) => {
    // 1. Create workspace + task with mcp_call scenario as description
    await createWorkspace(client, "Workpad E2E");
    const workspaceId = await getWorkspaceId(client, "Workpad E2E");
    const scenario = stubScenario(
      emitMcpCall("workpad_write", {
        status: "completed",
        summary: "Implemented auth middleware",
        extra: { branch: "feat/auth", pr: 42 },
      }),
    );
    const task = await createTaskDirect(client, workspaceId, "workpad-write-test", {
      description: JSON.stringify(scenario),
      environmentId: "test-local",
    });
    const taskId = task.id as string;

    // 2. Start task with stub-mcp persona (makes real MCP calls)
    const sessionId = await startTaskStubMcp(client, taskId);

    // 3. Wait for session to complete (scenario runs mcp_call then emits "completed")
    await waitForSessionStatus(client, sessionId, "stopped", 30_000);

    // 4. Fetch task and verify workpad was persisted
    const updatedTask = await client.getTask({ id: taskId });
    expect(updatedTask.workpad).toBeTruthy();
    const workpad = JSON.parse(updatedTask.workpad) as Record<string, unknown>;
    expect(workpad.status).toBe("completed");
    expect(workpad.summary).toBe("Implemented auth middleware");
    expect(workpad.extra).toEqual({ branch: "feat/auth", pr: 42 });
  });

  test("new session sees workpad written via setWorkpad RPC in system context", async ({ grackle: { client } }) => {
    test.setTimeout(60_000);

    // 1. Create workspace + task
    await createWorkspace(client, "Workpad Context");
    const workspaceId = await getWorkspaceId(client, "Workpad Context");
    const scenario = stubScenario(
      emitMcpCall("workpad_read", {}),
    );
    const task = await createTaskDirect(client, workspaceId, "workpad-context-test", {
      description: JSON.stringify(scenario),
      environmentId: "test-local",
    });
    const taskId = task.id as string;

    // 2. Write workpad directly via RPC (simulates a previous session having written it)
    await client.setWorkpad({
      taskId,
      workpad: JSON.stringify({ status: "done", summary: "Previous agent completed PR #100" }),
    });

    // 3. Start a session — it should see the workpad in its system context
    const sessionId = await startTaskStubMcp(client, taskId);
    await waitForSessionStatus(client, sessionId, "stopped", 30_000);

    // 4. Fetch session events and verify system context contains workpad
    const eventsResp = await client.getSessionEvents({ id: sessionId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (eventsResp.events || []) as any[];
    const systemEvent = events.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => {
        if (e.raw) {
          try {
            const raw = JSON.parse(e.raw) as Record<string, unknown>;
            if (raw.systemContext === true) {
              return true;
            }
          } catch { /* not JSON */ }
        }
        return false;
      },
    );

    expect(systemEvent).toBeDefined();
    expect(systemEvent.content).toContain("Previous Session Workpad");
    expect(systemEvent.content).toContain("Previous agent completed PR #100");
  });
});
