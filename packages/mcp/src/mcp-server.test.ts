/**
 * Tests for MCP session lifecycle — specifically that abandoned sessions
 * are cleaned up when the SSE stream disconnects (#972).
 *
 * Also tests scoped-token workspaceId injection behavior: workspace management
 * tools must NOT have their workspaceId overridden by the caller's token context.
 *
 * Uses a real http.Server from createMcpServer with API-key auth and a
 * dummy gRPC port (no backend needed — API-key auth skips gRPC calls
 * during initialization).
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { z } from "zod";
import { createScopedToken } from "@grackle-ai/auth";
import { ROOT_TASK_ID } from "@grackle-ai/common";
import type { ToolDefinition } from "./tool-registry.js";
import { createMcpServer } from "./mcp-server.js";

// API key must be exactly 64 hex characters (API_KEY_LENGTH in auth-middleware)
const TEST_API_KEY = "a".repeat(64);

/** Spin up a real MCP server on an ephemeral port. */
function startServer(toolGroups?: ToolDefinition[][]): Promise<http.Server> {
  const server = createMcpServer({
    bindHost: "127.0.0.1",
    mcpPort: 0,
    grpcPort: 19999, // dummy — no gRPC backend needed for these tests
    apiKey: TEST_API_KEY,
    toolGroups,
  });
  return new Promise<http.Server>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** Get the port the server is listening on. */
function port(server: http.Server): number {
  return (server.address() as { port: number }).port;
}

/** Standard MCP headers for POST requests. Optional authHeader overrides the default API-key bearer. */
function postHeaders(sessionId?: string, authHeader?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": authHeader ?? `Bearer ${TEST_API_KEY}`,
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
    headers["mcp-protocol-version"] = "2025-03-26";
  }
  return headers;
}

/** Send an MCP initialize request and return the session ID. */
function initialize(server: http.Server, authHeader?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: port(server),
        path: "/mcp",
        method: "POST",
        headers: postHeaders(undefined, authHeader),
      },
      (res) => {
        const sessionId = res.headers["mcp-session-id"] as string | undefined;
        // Consume the response body (SSE stream) — read until stream ends
        res.on("data", () => {});
        res.on("end", () => {
          if (!sessionId) {
            reject(new Error("No session ID in response"));
            return;
          }
          resolve(sessionId);
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send a POST request to an existing session (e.g. tools/list).
 * Returns the HTTP status code.
 */
function postToSession(
  server: http.Server,
  sessionId: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: port(server),
        path: "/mcp",
        method: "POST",
        headers: postHeaders(sessionId),
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk: Buffer) => { responseBody += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode!, body: responseBody }));
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send a tools/call MCP request and return the parsed JSON-RPC result body.
 * The response arrives as SSE; this helper reads the first data event.
 */
function callTool(
  server: http.Server,
  sessionId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  authHeader?: string,
): Promise<{ status: number; result: unknown }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs },
    });

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: port(server),
        path: "/mcp",
        method: "POST",
        headers: postHeaders(sessionId, authHeader),
      },
      (res) => {
        let rawBody = "";
        res.on("data", (chunk: Buffer) => { rawBody += chunk.toString(); });
        res.on("end", () => {
          // Response is SSE: parse first `data:` line
          const dataLine = rawBody.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) {
            reject(new Error(`No SSE data line in response body: ${rawBody}`));
            return;
          }
          try {
            const parsed = JSON.parse(dataLine.slice("data:".length).trim()) as unknown;
            resolve({ status: res.statusCode!, result: parsed });
          } catch (e) {
            reject(new Error(`Failed to parse SSE data: ${dataLine}`));
          }
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Open a GET SSE stream for the given session. Returns the request object
 * so the caller can abort it to simulate a client crash.
 */
function openSseStream(
  server: http.Server,
  sessionId: string,
): { req: http.ClientRequest; connected: Promise<void> } {
  let resolveConnected: () => void;
  let rejectConnected: (err: Error) => void;
  const connected = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });

  const req = http.request({
    hostname: "127.0.0.1",
    port: port(server),
    path: "/mcp",
    method: "GET",
    headers: {
      "Accept": "text/event-stream",
      "Authorization": `Bearer ${TEST_API_KEY}`,
      "mcp-session-id": sessionId,
      "mcp-protocol-version": "2025-03-26",
    },
  }, (res) => {
    if (res.statusCode !== 200) {
      rejectConnected!(new Error(`Unexpected SSE status code: ${res.statusCode}`));
      res.resume();
      return;
    }
    resolveConnected!();
    // Keep consuming data so the stream stays open
    res.on("data", () => {});
    res.on("end", () => {});
  });

  req.on("error", (err: NodeJS.ErrnoException) => {
    // Ignore the expected error when the client aborts the request,
    // but surface all other errors so tests don't hang silently.
    if (err.code === "ECONNRESET") {
      return;
    }
    rejectConnected!(err);
  });

  req.end();

  return { req, connected };
}

/** Poll until a condition is met, with a timeout to avoid hanging. */
async function waitUntil(
  fn: () => Promise<boolean>,
  timeoutMs: number = 2000,
  intervalMs: number = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

describe("MCP session cleanup on SSE disconnect", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => { server!.close(() => resolve()); });
      server = undefined;
    }
  });

  it("cleans up session when GET SSE stream is aborted", async () => {
    server = await startServer();

    // 1. Initialize a session
    const sessionId = await initialize(server!);
    expect(sessionId).toBeTruthy();

    // 2. Verify session is alive
    const alive = await postToSession(server!, sessionId);
    expect(alive.status).toBe(200);

    // 3. Open SSE stream, then abort it (simulate client crash)
    const sse = openSseStream(server!, sessionId);
    await sse.connected;
    sse.req.destroy();

    // 4. Poll until session is cleaned up (close event propagation)
    await waitUntil(async () => {
      const resp = await postToSession(server!, sessionId);
      return resp.status === 400;
    });

    // 5. Session should be gone — POST with old session ID returns 400
    const dead = await postToSession(server!, sessionId);
    expect(dead.status).toBe(400);
  });

  it("still cleans up session on explicit DELETE", async () => {
    server = await startServer();

    const sessionId = await initialize(server!);

    // Send DELETE
    const deleteResult = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: port(server!),
          path: "/mcp",
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${TEST_API_KEY}`,
            "mcp-session-id": sessionId,
            "mcp-protocol-version": "2025-03-26",
          },
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.end();
    });

    expect(deleteResult).toBe(200);

    // Session should be gone
    const dead = await postToSession(server!, sessionId);
    expect(dead.status).toBe(400);
  });

  it("only cleans up the disconnected session, not others", async () => {
    server = await startServer();

    // Initialize two sessions
    const sessionA = await initialize(server!);
    const sessionB = await initialize(server!);

    // Open SSE for session A, then abort it
    const sseA = openSseStream(server!, sessionA);
    await sseA.connected;
    sseA.req.destroy();

    // Poll until session A is cleaned up
    await waitUntil(async () => {
      const resp = await postToSession(server!, sessionA);
      return resp.status === 400;
    });

    // Session A should be gone
    const deadA = await postToSession(server!, sessionA);
    expect(deadA.status).toBe(400);

    // Session B should still work
    const aliveB = await postToSession(server!, sessionB);
    expect(aliveB.status).toBe(200);
  });
});

// ─── Scoped token workspaceId injection tests ──────────────────────────────

/** Build a spy ToolDefinition that records the args it receives. */
function makeSpyTool(
  name: string,
  group: string,
  capturedArgs: Record<string, unknown>[],
  schema: ReturnType<typeof z.object>,
): ToolDefinition {
  return {
    name,
    group,
    description: `Spy tool (${group}) that captures args for injection testing.`,
    inputSchema: schema,
    rpcMethod: "getWorkspace",
    mutating: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(args) {
      capturedArgs.push({ ...args });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    },
  };
}

describe("scoped token workspaceId injection", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => { server!.close(() => resolve()); });
      server = undefined;
    }
  });

  /**
   * Root-task scoped token: workspace management tools (group: "workspace") must
   * receive the caller-supplied workspaceId, not the token's workspace.
   * Regression test for #1179.
   */
  it("root task: workspace group tool receives caller-provided workspaceId", async () => {
    const capturedArgs: Record<string, unknown>[] = [];
    const spyTool = makeSpyTool("workspace_spy", "workspace", capturedArgs, z.object({ workspaceId: z.string() }));

    server = await startServer([[spyTool]]);

    // ROOT_TASK_ID has full tool access; its workspace token is "default-ws"
    const scopedToken = createScopedToken(
      { sub: ROOT_TASK_ID, pid: "default-ws", per: "system", sid: "sess-1" },
      TEST_API_KEY,
    );
    const authHeader = `Bearer ${scopedToken}`;

    const sessionId = await initialize(server!, authHeader);
    const { result } = await callTool(server!, sessionId, "workspace_spy", { workspaceId: "target-ws" }, authHeader);

    expect(capturedArgs).toHaveLength(1);
    // Handler must receive the caller-provided ID, not the token's "default-ws"
    expect(capturedArgs[0]!.workspaceId).toBe("target-ws");
    expect(result).toBeTruthy();
  });

  /**
   * Non-root scoped token with a bound workspace: calling a workspace tool with
   * a different workspaceId must be rejected. For agents using the default scoped
   * tool set, workspace management tools are not in the allowlist at all, so the
   * rejection happens at the access control layer before injection runs.
   * An admin-persona agent reaching injection would hit PERMISSION_DENIED there.
   * Either way, the handler must not be called.
   */
  it("non-root scoped agent: cross-workspace workspace tool call is rejected", async () => {
    const capturedArgs: Record<string, unknown>[] = [];
    const spyTool = makeSpyTool("workspace_spy", "workspace", capturedArgs, z.object({ workspaceId: z.string() }));

    server = await startServer([[spyTool]]);

    // Non-root task bound to "ws-a"; attempting to target "ws-b"
    const scopedToken = createScopedToken(
      { sub: "task-abc", pid: "ws-a", per: "system", sid: "sess-2" },
      TEST_API_KEY,
    );
    const authHeader = `Bearer ${scopedToken}`;

    const sessionId = await initialize(server!, authHeader);
    const { result } = await callTool(server!, sessionId, "workspace_spy", { workspaceId: "ws-b" }, authHeader);

    // Handler must NOT have been called — rejected before or at injection
    expect(capturedArgs).toHaveLength(0);
    const resultObj = result as { result?: { isError?: boolean } };
    expect(resultObj?.result?.isError).toBe(true);
  });

  /**
   * Non-workspace tools (e.g. task group) DO have their workspaceId overridden
   * by the scoped token — this is the intended behavior that prevents task agents
   * from escaping their workspace context.
   */
  it("non-workspace group tool has workspaceId overridden by scoped token", async () => {
    const capturedArgs: Record<string, unknown>[] = [];
    const spyTool = makeSpyTool("task_spy", "task", capturedArgs, z.object({ workspaceId: z.string().optional() }));

    server = await startServer([[spyTool]]);

    const scopedToken = createScopedToken(
      { sub: ROOT_TASK_ID, pid: "default-ws", per: "system", sid: "sess-3" },
      TEST_API_KEY,
    );
    const authHeader = `Bearer ${scopedToken}`;

    const sessionId = await initialize(server!, authHeader);
    // Caller passes "other-ws" but token says "default-ws" — injection should override
    await callTool(server!, sessionId, "task_spy", { workspaceId: "other-ws" }, authHeader);

    expect(capturedArgs).toHaveLength(1);
    // Injection must override with the token's workspace
    expect(capturedArgs[0]!.workspaceId).toBe("default-ws");
  });
});
