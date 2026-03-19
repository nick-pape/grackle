import { describe, it, expect, vi, beforeEach } from "vitest";
import { StubMcpRuntime } from "./stub-mcp.js";
import type { AgentEvent } from "./runtime.js";

// Mock the MCP SDK modules (dynamic imports in performMcpToolCall)
const mockConnect = vi.fn();
const mockCallTool = vi.fn();
const mockClose = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    callTool: mockCallTool,
    close: mockClose,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

describe("StubMcpRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has name 'stub-mcp'", () => {
    const runtime = new StubMcpRuntime();
    expect(runtime.name).toBe("stub-mcp");
  });

  it("spawn() returns session with correct id, runtimeName, runtimeSessionId", () => {
    const runtime = new StubMcpRuntime();
    const session = runtime.spawn({
      sessionId: "test-123",
      prompt: "hello",
      model: "test-model",
      maxTurns: 5,
    });

    expect(session.id).toBe("test-123");
    expect(session.runtimeName).toBe("stub-mcp");
    expect(session.runtimeSessionId).toBe("stub-mcp-test-123");
  });

  it("full stream lifecycle without mcpBroker (fallback to echo tool)", async () => {
    const runtime = new StubMcpRuntime();
    const session = runtime.spawn({
      sessionId: "lifecycle-1",
      prompt: "test prompt",
      model: "m",
      maxTurns: 1,
    });

    const events: AgentEvent[] = [];

    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          setTimeout(() => session.sendInput("user reply"), 0);
        }
      }
    })();

    await streamDone;

    // Verify event sequence matches stub fallback
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "system",
      "text",
      "tool_use",
      "tool_result",
      "status",     // waiting_input
      "status",     // running
      "text",       // user reply echo
      "status",     // completed
    ]);

    // Verify content
    expect(events[0].content).toBe("Stub MCP runtime initialized");
    expect(events[1].content).toBe("Echo: test prompt");
    expect(JSON.parse(events[2].content)).toEqual({
      tool: "echo",
      args: { message: "test prompt" },
    });
    expect(events[3].content).toBe('Tool output: "test prompt"');
    expect(events[4].content).toBe("waiting_input");
    expect(events[5].content).toBe("running");
    expect(events[6].content).toBe("You said: user reply");
    expect(events[7].content).toBe("completed");

    // Verify timestamps are ISO strings
    for (const event of events) {
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    expect(session.status).toBe("completed");
  });

  it("kill() before input results in early termination", async () => {
    const runtime = new StubMcpRuntime();
    const session = runtime.spawn({
      sessionId: "kill-early",
      prompt: "test",
      model: "m",
      maxTurns: 1,
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          session.kill();
        }
      }
    })();

    await streamDone;
    expect(session.status).toBe("interrupted");

    const statusEvents = events.filter((e) => e.type === "status");
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].content).toBe("waiting_input");
  });

  it("sendInput('fail') triggers failure status", async () => {
    const runtime = new StubMcpRuntime();
    const session = runtime.spawn({
      sessionId: "fail-1",
      prompt: "test",
      model: "m",
      maxTurns: 1,
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          setTimeout(() => session.sendInput("fail"), 0);
        }
      }
    })();

    await streamDone;
    expect(session.status).toBe("failed");

    const statusEvents = events.filter((e) => e.type === "status");
    expect(statusEvents.map((e) => e.content)).toEqual(["waiting_input", "failed"]);
  });

  it("successful MCP tool call yields tool_use and tool_result with raw metadata", async () => {
    mockConnect.mockResolvedValue(undefined);
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "[]" }] });
    mockClose.mockResolvedValue(undefined);

    const runtime = new StubMcpRuntime();
    const session = runtime.spawn({
      sessionId: "mcp-ok-1",
      prompt: "test",
      model: "m",
      maxTurns: 1,
      mcpBroker: { url: "http://localhost:9999/mcp", token: "test-token" },
      workspaceId: "proj-1",
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          setTimeout(() => session.sendInput("done"), 0);
        }
      }
    })();

    await streamDone;

    // Should use MCP path, not fallback echo
    const toolUse = events.find((e) => e.type === "tool_use");
    expect(toolUse).toBeDefined();
    expect(JSON.parse(toolUse!.content)).toEqual({ tool: "task_list", args: {} });
    expect(toolUse!.raw).toEqual({
      type: "tool_use", id: "toolu_stub_mcp_1", name: "task_list", input: {},
    });

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.raw).toEqual({
      type: "tool_result", tool_use_id: "toolu_stub_mcp_1", is_error: false,
    });

    // Verify MCP client was closed
    expect(mockClose).toHaveBeenCalled();
    expect(session.status).toBe("completed");
  });

  it("MCP connect error yields is_error tool_result and continues to waiting_input", async () => {
    mockConnect.mockRejectedValue(new Error("Connection refused"));
    mockClose.mockResolvedValue(undefined);

    const runtime = new StubMcpRuntime();
    const session = runtime.spawn({
      sessionId: "mcp-err-1",
      prompt: "test",
      model: "m",
      maxTurns: 1,
      mcpBroker: { url: "http://localhost:9999/mcp", token: "test-token" },
      workspaceId: "proj-1",
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          setTimeout(() => session.sendInput("continue"), 0);
        }
      }
    })();

    await streamDone;

    // Should still yield tool_use + error tool_result
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult!.raw).toEqual({
      type: "tool_result", tool_use_id: "toolu_stub_mcp_1", is_error: true,
    });
    const resultContent = JSON.parse(toolResult!.content);
    expect(resultContent.error).toBe("Connection refused");

    // Session should still complete (error doesn't kill it)
    expect(session.status).toBe("completed");
  });

  it("resume() uses '(resumed session)' prompt", async () => {
    const runtime = new StubMcpRuntime();
    const session = runtime.resume({
      sessionId: "resume-1",
      runtimeSessionId: "old-session",
    });

    expect(session.id).toBe("resume-1");

    const events: AgentEvent[] = [];
    for await (const event of session.stream()) {
      events.push(event);
      if (event.type === "status" && event.content === "waiting_input") {
        session.kill();
        break;
      }
    }

    const textEvent = events.find((e) => e.type === "text" && e.content.startsWith("Echo:"));
    expect(textEvent).toBeDefined();
    expect(textEvent!.content).toBe("Echo: (resumed session)");
  });
});
