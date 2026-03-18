import { describe, it, expect } from "vitest";
import { StubMcpRuntime } from "./stub-mcp.js";
import type { AgentEvent } from "./runtime.js";

describe("StubMcpRuntime", () => {
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
