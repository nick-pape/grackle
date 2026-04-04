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
  const resp = await client.orchestration.startTask({
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
  const resp = await client.orchestration.startTask({
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
    const resp = await client.core.listSessions({});
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
    const sessionsResp = await client.core.listSessions({});
    const all = sessionsResp.sessions as Array<{ id: string; status: string }>;
    const active = all.filter((s) => s.status === "idle" || s.status === "running" || s.status === "pending");
    for (const s of active) {
      await client.core.killAgent({ id: s.id });
    }
    if (active.length > 0) {
      await expect(async () => {
        const recheck = await client.core.listSessions({});
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
    await client.orchestration.updateTask({
      id: orchestrator.id as string,
      description: JSON.stringify(orchestratorScenario),
    });

    // 4. Start orchestrator with stub-mcp persona (real MCP calls with scoped token)
    const orchSessionId = await startTaskStubMcp(client, orchestrator.id as string);
    await waitForSessionStatus(client, orchSessionId, "stopped");

    // 5. Verify the session_attach MCP call succeeded
    const eventsResp = await client.core.getSessionEvents({ id: orchSessionId });
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
    await client.orchestration.updateTask({
      id: orchestrator.id as string,
      description: JSON.stringify(orchestratorScenario),
    });

    // 4. Start orchestrator — allow extra time on slow CI runners
    const orchSessionId = await startTaskStubMcp(client, orchestrator.id as string);
    await waitForSessionStatus(client, orchSessionId, "stopped", 45_000);

    // 5. Verify logs_get succeeded — response contains the child session ID
    const eventsResp = await client.core.getSessionEvents({ id: orchSessionId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (eventsResp.events || []) as any[];

    const toolResult = findToolResult(events, childSessionId);
    expect(toolResult).toBeDefined();
    expect(toolResult.content).not.toContain("PERMISSION_DENIED");
  });
});

// ─── workspace_get scoped-token injection regression test (#1179) ─────────────

test.describe("workspace_get respects explicit workspaceId under scoped token", { tag: ["@task"] }, () => {
  // Kill stale active sessions before each test to free the environment.
  test.beforeEach(async ({ grackle: { client } }) => {
    const sessionsResp = await client.core.listSessions({});
    const all = sessionsResp.sessions as Array<{ id: string; status: string }>;
    const active = all.filter((s) => s.status === "idle" || s.status === "running" || s.status === "pending");
    for (const s of active) {
      await client.core.killAgent({ id: s.id });
    }
    if (active.length > 0) {
      await expect(async () => {
        const recheck = await client.core.listSessions({});
        const remaining = recheck.sessions as Array<{ status: string }>;
        const stillActive = remaining.filter(
          (s) => s.status === "idle" || s.status === "running" || s.status === "pending",
        );
        expect(stillActive.length).toBe(0);
      }).toPass({ timeout: 5_000, intervals: [250] });
    }
  });

  /**
   * Regression test for #1179: workspace management tools (workspace_get, etc.) must
   * NOT have their workspaceId silently overridden by the scoped token's bound workspace.
   *
   * Before the fix: calling workspace_get with workspaceId="B" from an agent bound to
   * workspace "A" would silently redirect the call to workspace "A" and return A's data.
   * After the fix: the call is rejected with PERMISSION_DENIED — cross-workspace access
   * is blocked, not silently redirected.
   *
   * Test strategy: create a persona that grants workspace_get access (not in the default
   * scoped tool set), run an orchestrator in workspace A that calls workspace_get on
   * workspace B, and assert the result is PERMISSION_DENIED (not workspace A's data).
   */
  test("cross-workspace workspace_get is rejected, not silently redirected to bound workspace", async ({ grackle: { client } }) => {
    test.setTimeout(60_000);

    // 1. Create two distinct workspaces (orchestrator runs in A, calls workspace_get on B)
    const workspaceAId = await createWorkspace(client, "ws-1179-a");
    const workspaceBId = await createWorkspace(client, "ws-1179-b");

    // 2. Create a persona that explicitly allows workspace_get.
    //    workspace_get is NOT in DEFAULT_SCOPED_MCP_TOOLS, so it must be explicitly granted.
    const wsAdminPersona = await client.orchestration.createPersona({
      name: "stub-mcp-ws-admin-1179",
      systemPrompt: "Workspace admin test persona for #1179 regression",
      runtime: "stub-mcp",
      model: "sonnet",
      allowedMcpTools: ["workspace_get"],
    });

    // 3. Create an orchestrator task in workspace A
    const orchestrator = await createTaskDirect(client, workspaceAId, "orchestrator-1179", {
      canDecompose: true,
    });

    // 4. Scenario: call workspace_get on workspace B from an agent bound to workspace A.
    //    Before the fix, this would silently return workspace A's data.
    //    After the fix, the cross-workspace call is rejected with PERMISSION_DENIED.
    const scenario = stubScenario(
      emitMcpCall("workspace_get", { workspaceId: workspaceBId }),
    );
    await client.orchestration.updateTask({
      id: orchestrator.id as string,
      description: JSON.stringify(scenario),
    });

    // 5. Start the orchestrator with the ws-admin persona (real MCP calls + scoped token)
    const sessionId = await (async () => {
      const resp = await client.orchestration.startTask({
        taskId: orchestrator.id as string,
        personaId: wsAdminPersona.id as string,
        environmentId: "test-local",
      });
      if (!resp.id) {
        throw new Error("No session ID in startTask response");
      }
      return resp.id;
    })();
    await waitForSessionStatus(client, sessionId, "stopped");

    // 6. Inspect events — the workspace_get call must be rejected (PERMISSION_DENIED),
    //    not silently redirected to return workspace A's data.
    const eventsResp = await client.core.getSessionEvents({ id: sessionId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (eventsResp.events || []) as any[];

    // The regression: before the fix, the workspace_get would return workspace A's data.
    // After the fix, it returns PERMISSION_DENIED.
    const rejectionResult = findToolResult(events, "PERMISSION_DENIED");
    expect(rejectionResult, "cross-workspace workspace_get must be rejected with PERMISSION_DENIED").toBeDefined();
    // Critically: must NOT contain workspace A's data (that would be the silent redirect bug)
    expect(rejectionResult.content, "must not silently redirect to bound workspace A").not.toContain(workspaceAId);
  });
});
