import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import {
  createWorkspace,
  createTaskDirect,
  getWorkspaceId,
  stubScenario,
  emitMcpCall,
  idle,
} from "./helpers.js";

/** Poll listSessions until the session reaches the target status. */
async function waitForSessionStatus(
  client: GrackleClient,
  sessionId: string,
  targetStatus: string,
  timeoutMs: number = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await client.core.listSessions({});
    const session = resp.sessions.find((s) => s.id === sessionId);
    if (session && session.status === targetStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Session ${sessionId} did not reach status "${targetStatus}" within ${timeoutMs}ms`);
}

/** Poll getSessionEvents until content matching pattern appears. */
async function waitForSessionText(
  client: GrackleClient,
  sessionId: string,
  pattern: string,
  timeoutMs: number = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await client.core.getSessionEvents({ id: sessionId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (resp.events || []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = events.find((e: any) => {
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
    });
    if (match) {
      return match.content as string;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Session ${sessionId} did not emit text matching "${pattern}" within ${timeoutMs}ms`);
}

/** Poll getSessionFds until a fd with the given streamName appears. */
async function waitForStreamFd(
  client: GrackleClient,
  sessionId: string,
  streamName: string,
  timeoutMs: number = 20_000,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await client.core.getSessionFds({ id: sessionId }) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fd = (resp.fds || []).find((f: any) => f.streamName === streamName);
    if (fd) {
      return fd;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Session ${sessionId} did not get a fd for stream "${streamName}" within ${timeoutMs}ms`);
}

test.describe("ipc_share_stream", () => {
  test("child shares a named stream with its parent via the pipe notification", async ({
    grackle: { client },
  }) => {
    test.setTimeout(90_000);

    // 1. Workspace setup
    await createWorkspace(client, "IPC Share Stream");
    const workspaceId = await getWorkspaceId(client, "IPC Share Stream");

    // 2. Build the child scenario.
    const childScenario = stubScenario(
      emitMcpCall("ipc_create_stream", { name: "e2e-shared-stream" }),
      emitMcpCall("ipc_share_stream", { streamName: "e2e-shared-stream" }),
      idle(),
    );

    // 3. Build the parent scenario: spawn the child (async pipe) then idle to receive [stream-ref].
    const parentScenario = stubScenario(
      emitMcpCall("ipc_spawn", {
        prompt: JSON.stringify(childScenario),
        pipe: "async",
        environmentId: "test-local",
        personaId: "stub-mcp",
      }),
      idle(),
    );

    // 4. Create parent task
    const parent = await createTaskDirect(client, workspaceId, "IPC Share Parent", {
      canDecompose: true,
      environmentId: "test-local",
      description: JSON.stringify(parentScenario),
    });
    const parentId = parent.id as string;

    // 5. Start parent with stub-mcp (makes real MCP calls)
    const parentResp = await client.orchestration.startTask({
      taskId: parentId,
      personaId: "stub-mcp",
      environmentId: "test-local",
    });
    const parentSessionId = parentResp.id;
    if (!parentSessionId) {
      throw new Error("No session ID for parent");
    }

    // 6. Wait for the stream fd to appear on the parent (created by ipc_share_stream → attachStream).
    //    The child runs so quickly (~200 ms) that the parent may already be idle-then-stopped
    //    by the time we poll — but lifecycle streams persist until the reconciliation cycle
    //    (10 s), so getSessionFds still returns the fd after the parent session completes.
    const sharedFd = await waitForStreamFd(client, parentSessionId, "e2e-shared-stream", 20_000);
    expect(sharedFd).toBeTruthy();
    expect(sharedFd.permission).toBe("rw");

    // 7. Wait for the [stream-ref] pipe notification to appear in the parent's event log
    //    (written by ipc_share_stream → writeToFd; echoed by the parent's default on_input handler).
    await waitForSessionText(client, parentSessionId, "[stream-ref]", 20_000);

    // Cleanup — parent may already be stopped (scenario ended after echoing the pipe message).
    try {
      await client.core.killAgent({ id: parentSessionId });
    } catch { /* already stopped */ }
    await waitForSessionStatus(client, parentSessionId, "stopped");
  });
});
