import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import {
  createWorkspace,
  createTaskDirect,
  getWorkspaceId,
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
  if (!resp.id) {
    throw new Error(`No session ID in startTask response for task ${taskId}`);
  }
  return resp.id;
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
 * Helper: poll getTask until parentTaskId matches expected value.
 */
async function waitForTaskParent(
  client: GrackleClient,
  taskId: string,
  expectedParentId: string,
  timeoutMs: number = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const task = await client.getTask({ id: taskId }) as any;
    if (task.parentTaskId === expectedParentId) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Task ${taskId} parentTaskId did not change to "${expectedParentId}" within ${timeoutMs}ms`);
}

/**
 * Helper: poll session events until content matching pattern appears.
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
        if (e.raw) {
          try {
            const raw = JSON.parse(e.raw) as Record<string, unknown>;
            if (raw.systemContext === true) {
              return false;
            }
          } catch { /* not JSON */ }
        }
        return true;
      },
    );
    if (match) return match.content as string;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Session ${sessionId} events never contained "${pattern}" within ${timeoutMs}ms`);
}

test.describe("Orphan reparenting — task adoption", { tag: ["@task"] }, () => {
  // Kill stale sessions before each test
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

  test("child reparented to grandparent when parent completes", async ({ grackle: { client } }) => {
    // 1. Create workspace + hierarchy: grandparent → parent → child
    await createWorkspace(client, "Orphan Test");
    const workspaceId = await getWorkspaceId(client, "Orphan Test");

    const grandparent = await createTaskDirect(client, workspaceId, "Grandparent Orchestrator", {
      canDecompose: true,
      environmentId: "test-local",
    });
    const grandparentId = grandparent.id as string;

    const parent = await createTaskDirect(client, workspaceId, "Parent Worker", {
      parentTaskId: grandparentId,
      canDecompose: true,
      environmentId: "test-local",
    });
    const parentId = parent.id as string;

    const child = await createTaskDirect(client, workspaceId, "Child Worker", {
      parentTaskId: parentId,
      environmentId: "test-local",
    });
    const childId = child.id as string;

    // 2. Start grandparent → IDLE
    const gpSessionId = await startTaskAndGetSessionId(client, grandparentId);
    await waitForSessionStatus(client, gpSessionId, "idle");

    // 3. Start child → IDLE
    const childSessionId = await startTaskAndGetSessionId(client, childId);
    await waitForSessionStatus(client, childSessionId, "idle");

    // 4. Complete the parent task
    await client.completeTask({ id: parentId });

    // 5. Verify child was reparented to grandparent
    await waitForTaskParent(client, childId, grandparentId, 15_000);

    // 6. Verify grandparent received [ADOPTED] signal
    const adoptedContent = await waitForSessionText(client, gpSessionId, "[ADOPTED]", 30_000);
    expect(adoptedContent).toContain("Child Worker");
    expect(adoptedContent).toContain("Parent Worker");

    // Cleanup
    await client.killAgent({ id: childSessionId });
    await waitForSessionStatus(client, childSessionId, "stopped");
    await client.killAgent({ id: gpSessionId });
    await waitForSessionStatus(client, gpSessionId, "stopped");
  });

  test("terminal children are NOT reparented", async ({ grackle: { client } }) => {
    // 1. Create hierarchy
    await createWorkspace(client, "Orphan Terminal Test");
    const workspaceId = await getWorkspaceId(client, "Orphan Terminal Test");

    const grandparent = await createTaskDirect(client, workspaceId, "GP Terminal", {
      canDecompose: true,
      environmentId: "test-local",
    });
    const grandparentId = grandparent.id as string;

    const parent = await createTaskDirect(client, workspaceId, "Parent Terminal", {
      parentTaskId: grandparentId,
      canDecompose: true,
      environmentId: "test-local",
    });
    const parentId = parent.id as string;

    const doneChild = await createTaskDirect(client, workspaceId, "Done Child", {
      parentTaskId: parentId,
      environmentId: "test-local",
    });
    const doneChildId = doneChild.id as string;

    const activeChild = await createTaskDirect(client, workspaceId, "Active Child", {
      parentTaskId: parentId,
      environmentId: "test-local",
    });
    const activeChildId = activeChild.id as string;

    // 2. Complete one child first
    await client.completeTask({ id: doneChildId });

    // 3. Complete parent
    await client.completeTask({ id: parentId });

    // 4. Active child should be reparented to grandparent
    await waitForTaskParent(client, activeChildId, grandparentId, 15_000);

    // 5. Done child should remain under original parent (not reparented)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doneTask = await client.getTask({ id: doneChildId }) as any;
    expect(doneTask.parentTaskId).toBe(parentId);
  });
});
