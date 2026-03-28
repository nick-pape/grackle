import { test, expect } from "./fixtures.js";
import type { GrackleClient } from "./rpc-client.js";
import { grackle } from "@grackle-ai/common";
import {
  createWorkspace,
  createTaskDirect,
  stubScenario,
  emitText,
  emitMcpCall,
} from "./helpers.js";

/** Event type enum value from proto — avoids hardcoding the numeric value. */
const EVENT_TYPE_TOOL_RESULT = grackle.EventType.TOOL_RESULT;

/**
 * Helper: start a task via RPC with stub persona and return the session ID.
 */
async function startTaskStub(
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
  timeoutMs: number = 20_000,
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
 * Find the first tool_result event whose content contains the given substring.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findToolResult(events: any[], contentSubstring: string): any | undefined {
  return events.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => e.type === EVENT_TYPE_TOOL_RESULT &&
      typeof e.content === "string" &&
      e.content.includes(contentSubstring),
  );
}

test.describe("Scoped session_attach and logs_get", { tag: ["@task"] }, () => {
  // Kill any stale active sessions before each test to free the environment.
  test.beforeEach(async ({ grackle: { client } }) => {
    const sessionsResp = await client.listSessions({});
    const all = sessionsResp.sessions as Array<{ id: string; status: string }>;
    const active = all.filter((s) => s.status === "idle" || s.status === "running" || s.status === "pending");
    for (const s of active) {
      await client.killAgent({ id: s.id });
    }
    if (active.length > 0) {
      await expect(async () => {
        const recheck = await client.listSessions({});
        const remaining = recheck.sessions as Array<{ status: string }>;
        const stillActive = remaining.filter(
          (s) => s.status === "idle" || s.status === "running" || s.status === "pending",
        );
        expect(stillActive.length).toBe(0);
      }).toPass({ timeout: 5_000, intervals: [250] });
    }
  });

  test("orchestrator can session_attach to child session via scoped MCP", async ({ grackle: { client } }) => {
    test.setTimeout(60_000);

    // 1. Create workspace + orchestrator task + child task
    const workspaceId = await createWorkspace(client, "Scoped Attach");
    const orchestrator = await createTaskDirect(client, workspaceId, "orchestrator", {
      canDecompose: true,
    });
    const child = await createTaskDirect(client, workspaceId, "child-worker", {
      parentTaskId: orchestrator.id as string,
      description: JSON.stringify(stubScenario(emitText("Hello from child"))),
    });

    // 2. Start the child task with stub runtime — it emits text and completes
    const childSessionId = await startTaskStub(client, child.id as string);
    await waitForSessionStatus(client, childSessionId, "stopped");

    // 3. Build orchestrator scenario that calls session_attach on child's session
    //    Use timeoutSeconds=2 to avoid hitting the 5s MCP call timeout
    const orchestratorScenario = stubScenario(
      emitMcpCall("session_attach", { sessionId: childSessionId, timeoutSeconds: 2 }),
    );
    await client.updateTask({
      id: orchestrator.id as string,
      description: JSON.stringify(orchestratorScenario),
    });

    // 4. Start orchestrator with stub-mcp persona (real MCP calls with scoped token)
    const orchSessionId = await startTaskStubMcp(client, orchestrator.id as string);
    await waitForSessionStatus(client, orchSessionId, "stopped");

    // 5. Verify the session_attach MCP call succeeded
    const eventsResp = await client.getSessionEvents({ id: orchSessionId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (eventsResp.events || []) as any[];

    // The tool_result content should contain "timedOut" (session_attach response shape)
    // and should NOT contain PERMISSION_DENIED
    const toolResult = findToolResult(events, "timedOut");
    expect(toolResult).toBeDefined();
    expect(toolResult.content).not.toContain("PERMISSION_DENIED");
  });

  test("orchestrator can logs_get from child session via scoped MCP", async ({ grackle: { client } }) => {
    test.setTimeout(60_000);

    // 1. Create workspace + orchestrator + child
    const workspaceId = await createWorkspace(client, "Scoped Logs");
    const orchestrator = await createTaskDirect(client, workspaceId, "orchestrator", {
      canDecompose: true,
    });
    const child = await createTaskDirect(client, workspaceId, "child-worker", {
      parentTaskId: orchestrator.id as string,
      description: JSON.stringify(stubScenario(emitText("Child output for logs"))),
    });

    // 2. Start + complete the child
    const childSessionId = await startTaskStub(client, child.id as string);
    await waitForSessionStatus(client, childSessionId, "stopped");

    // 3. Orchestrator calls logs_get on child's session (default mode: stream.jsonl)
    const orchestratorScenario = stubScenario(
      emitMcpCall("logs_get", { sessionId: childSessionId }),
    );
    await client.updateTask({
      id: orchestrator.id as string,
      description: JSON.stringify(orchestratorScenario),
    });

    // 4. Start orchestrator — allow extra time on slow CI runners
    const orchSessionId = await startTaskStubMcp(client, orchestrator.id as string);
    await waitForSessionStatus(client, orchSessionId, "stopped", 45_000);

    // 5. Verify logs_get succeeded — response contains the child session ID
    const eventsResp = await client.getSessionEvents({ id: orchSessionId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (eventsResp.events || []) as any[];

    const toolResult = findToolResult(events, childSessionId);
    expect(toolResult).toBeDefined();
    expect(toolResult.content).not.toContain("PERMISSION_DENIED");
  });
});
