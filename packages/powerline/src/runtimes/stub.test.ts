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

  it("full stream lifecycle: system → text → tool_use → tool_result → waiting_input → sendInput → running → text → waiting_input", async () => {
    const runtime = new StubRuntime();
    const session = runtime.spawn({
      sessionId: "lifecycle-1",
      prompt: "test prompt",
      model: "m",
      maxTurns: 1,
    });

    const events: AgentEvent[] = [];
    let inputSent = false;

    // Start streaming in the background and collect events
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        // When we see the first waiting_input, send input after a tick
        if (event.type === "status" && event.content === "waiting_input" && !inputSent) {
          inputSent = true;
          setTimeout(() => session.sendInput("user reply"), 0);
        }
        // When we see the second waiting_input (after reply), kill to finish
        if (event.type === "status" && event.content === "waiting_input" && inputSent && events.filter((e) => e.type === "status" && e.content === "waiting_input").length === 2) {
          session.kill();
          break;
        }
      }
    })();

    await streamDone;

    // Verify event sequence
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "system",
      "runtime_session_id",
      "text",
      "tool_use",
      "tool_result",
      "status",     // waiting_input
      "status",     // running
      "text",       // user reply echo
      "status",     // waiting_input (stub goes idle, not completed)
    ]);

    // Verify content
    expect(events[0].content).toBe("Stub runtime initialized");
    expect(events[1].content).toBe("stub-lifecycle-1");
    expect(events[2].content).toBe("Echo: test prompt");
    expect(JSON.parse(events[3].content)).toEqual({
      tool: "echo",
      args: { message: "test prompt" },
    });
    expect(events[4].content).toBe('Tool output: "test prompt"');
    expect(events[5].content).toBe("waiting_input");
    expect(events[6].content).toBe("running");
    expect(events[7].content).toBe("You said: user reply");
    expect(events[8].content).toBe("waiting_input");

    // Verify timestamps are ISO strings
    for (const event of events) {
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    // Verify final status (killed after second waiting_input)
    expect(session.status).toBe("stopped");
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

    let inputSent = false;
    const statusHistory: string[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        if (event.type === "status") {
          statusHistory.push(event.content);
          if (event.content === "waiting_input" && !inputSent) {
            expect(session.status).toBe("idle");
            inputSent = true;
            setTimeout(() => session.sendInput("go"), 0);
          } else if (event.content === "waiting_input" && inputSent) {
            // Second waiting_input — stub goes idle instead of completing; kill to end
            expect(session.status).toBe("idle");
            session.kill();
            break;
          }
        }
      }
    })();

    await streamDone;
    expect(statusHistory).toEqual(["waiting_input", "running", "waiting_input"]);
    expect(session.status).toBe("stopped");
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
    expect(session.status).toBe("stopped");

    // Should have waiting_input followed by killed
    const statusEvents = events.filter((e) => e.type === "status");
    expect(statusEvents).toHaveLength(2);
    expect(statusEvents[0].content).toBe("waiting_input");
    expect(statusEvents[1].content).toBe("killed");
  });

  it("emits runtime_session_id event early in the stream", async () => {
    const runtime = new StubRuntime();
    const session = runtime.spawn({
      sessionId: "rt-id-test",
      prompt: "hello",
      model: "m",
      maxTurns: 1,
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          session.kill();
          break;
        }
      }
    })();

    await streamDone;

    const rtIdEvent = events.find((e) => e.type === "runtime_session_id");
    expect(rtIdEvent).toBeDefined();
    expect(rtIdEvent!.content).toBe("stub-rt-id-test");
    expect(rtIdEvent!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("runtime_session_id event is emitted only once per session", async () => {
    const runtime = new StubRuntime();
    const session = runtime.spawn({
      sessionId: "rt-id-once",
      prompt: "hello",
      model: "m",
      maxTurns: 1,
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

    const rtIdEvents = events.filter((e) => e.type === "runtime_session_id");
    expect(rtIdEvents).toHaveLength(1);
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
    expect(session.status).toBe("stopped");

    // Should have system, text, tool_use but NOT tool_result or later
    const types = events.map((e) => e.type);
    expect(types).toContain("system");
    expect(types).toContain("text");
    expect(types).toContain("tool_use");
    // The tool_result might still appear since kill happens between yields
    // but no status events for waiting_input, running, or waiting_input
    const statusEvents = events.filter(
      (e) => e.type === "status" && (e.content === "running" || e.content === "waiting_input"),
    );
    expect(statusEvents).toHaveLength(0);
  });
});
