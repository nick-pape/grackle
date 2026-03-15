import { describe, it, expect } from "vitest";
import { StubRuntime } from "./stub.js";
import type { AgentEvent } from "./runtime.js";

describe("StubRuntime", () => {
  it("has name 'stub'", () => {
    const runtime = new StubRuntime();
    expect(runtime.name).toBe("stub");
  });

  it("spawn() returns session with correct id, runtimeName, runtimeSessionId", () => {
    const runtime = new StubRuntime();
    const session = runtime.spawn({
      sessionId: "test-123",
      prompt: "hello",
      model: "test-model",
      maxTurns: 5,
    });

    expect(session.id).toBe("test-123");
    expect(session.runtimeName).toBe("stub");
    expect(session.runtimeSessionId).toBe("stub-test-123");
  });

  it("resume() uses '(resumed session)' prompt", async () => {
    const runtime = new StubRuntime();
    const session = runtime.resume({
      sessionId: "resume-1",
      runtimeSessionId: "old-session",
    });

    expect(session.id).toBe("resume-1");

    // Collect events to verify the resumed prompt is used
    const events: AgentEvent[] = [];
    const stream = session.stream();
    for await (const event of stream) {
      events.push(event);
      // After system + text + tool_use + tool_result + status:waiting_input, kill to finish
      if (event.type === "status" && event.content === "waiting_input") {
        session.kill();
        break;
      }
    }

    const textEvent = events.find((e) => e.type === "text" && e.content.startsWith("Echo:"));
    expect(textEvent).toBeDefined();
    expect(textEvent!.content).toBe("Echo: (resumed session)");
  });

  it("full stream lifecycle: system → text → tool_use → tool_result → waiting_input → sendInput → running → text → completed", async () => {
    const runtime = new StubRuntime();
    const session = runtime.spawn({
      sessionId: "lifecycle-1",
      prompt: "test prompt",
      model: "m",
      maxTurns: 1,
    });

    const events: AgentEvent[] = [];

    // Start streaming in the background and collect events
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        // When we see waiting_input, send input after a tick
        if (event.type === "status" && event.content === "waiting_input") {
          setTimeout(() => session.sendInput("user reply"), 0);
        }
      }
    })();

    await streamDone;

    // Verify event sequence
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
    expect(events[0].content).toBe("Stub runtime initialized");
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

    // Verify final status
    expect(session.status).toBe("completed");
  });

  it("status transitions are correct at each step", async () => {
    const runtime = new StubRuntime();
    const session = runtime.spawn({
      sessionId: "status-check",
      prompt: "test",
      model: "m",
      maxTurns: 1,
    });

    expect(session.status).toBe("running");

    const statusHistory: string[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        if (event.type === "status") {
          statusHistory.push(event.content);
          if (event.content === "waiting_input") {
            expect(session.status).toBe("idle");
            setTimeout(() => session.sendInput("go"), 0);
          }
        }
      }
    })();

    await streamDone;
    expect(statusHistory).toEqual(["waiting_input", "running", "completed"]);
    expect(session.status).toBe("completed");
  });

  it("kill() before input results in early termination", async () => {
    const runtime = new StubRuntime();
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

    // Should not have any events after waiting_input
    const statusEvents = events.filter((e) => e.type === "status");
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].content).toBe("waiting_input");
  });

  it("kill() during tool phase results in early termination", async () => {
    const runtime = new StubRuntime();
    const session = runtime.spawn({
      sessionId: "kill-tool",
      prompt: "test",
      model: "m",
      maxTurns: 1,
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "tool_use") {
          session.kill();
        }
      }
    })();

    await streamDone;
    expect(session.status).toBe("interrupted");

    // Should have system, text, tool_use but NOT tool_result or later
    const types = events.map((e) => e.type);
    expect(types).toContain("system");
    expect(types).toContain("text");
    expect(types).toContain("tool_use");
    // The tool_result might still appear since kill happens between yields
    // but no status events for waiting_input, running, or completed
    const statusEvents = events.filter(
      (e) => e.type === "status" && (e.content === "running" || e.content === "completed"),
    );
    expect(statusEvents).toHaveLength(0);
  });
});
