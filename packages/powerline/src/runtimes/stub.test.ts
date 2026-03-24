import { describe, it, expect, beforeEach } from "vitest";
import { StubRuntime } from "./stub.js";
import type { AgentEvent, AgentSession } from "./runtime.js";
import { resetToolUseCounter } from "./stub-scenario.js";

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

// ─── Scenario Mode Tests ───────────────────────────────────

/** Helper: spawn a scenario session and collect all events. */
function spawnScenario(
  scenario: { steps: object[] },
  sessionId: string = "scenario-1",
): AgentSession {
  const runtime = new StubRuntime();
  return runtime.spawn({
    sessionId,
    prompt: JSON.stringify(scenario),
    model: "m",
    maxTurns: 1,
  });
}

/** Helper: collect all events from a session stream. */
async function collectEvents(session: AgentSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.stream()) {
    events.push(event);
  }
  return events;
}

describe("StubRuntime scenario mode", () => {
  beforeEach(() => {
    resetToolUseCounter();
  });

  it("single text emit yields system + runtime_session_id + text + completed", async () => {
    const session = spawnScenario({
      steps: [{ emit: "text", content: "Hello world" }],
    });

    const events = await collectEvents(session);
    const types = events.map((e) => e.type);

    expect(types).toEqual(["system", "runtime_session_id", "text", "status"]);
    expect(events[0].content).toBe("Stub runtime initialized");
    expect(events[1].content).toBe("stub-scenario-1");
    expect(events[2].content).toBe("Hello world");
    expect(events[3].content).toBe("completed");
    expect(session.status).toBe("stopped");
  });

  it("empty steps yields system + runtime_session_id + completed", async () => {
    const session = spawnScenario({ steps: [] });
    const events = await collectEvents(session);
    const types = events.map((e) => e.type);

    expect(types).toEqual(["system", "runtime_session_id", "status"]);
    expect(events[2].content).toBe("completed");
  });

  it("tool_use + tool_result sequence with correct raw fields", async () => {
    const session = spawnScenario({
      steps: [
        { emit: "tool_use", tool: "read_file", args: { path: "/foo" } },
        { emit: "tool_result", content: "file contents here" },
      ],
    });

    const events = await collectEvents(session);
    const toolUse = events.find((e) => e.type === "tool_use")!;
    const toolResult = events.find((e) => e.type === "tool_result")!;

    expect(toolUse).toBeDefined();
    expect(JSON.parse(toolUse.content)).toEqual({ tool: "read_file", args: { path: "/foo" } });
    expect(toolUse.raw).toEqual({
      type: "tool_use",
      id: "toolu_scenario_1",
      name: "read_file",
      input: { path: "/foo" },
    });

    expect(toolResult).toBeDefined();
    expect(toolResult.content).toBe("file contents here");
    expect(toolResult.raw).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_scenario_1",
      is_error: false,
    });
  });

  it("idle step goes idle, accepts input, echoes by default", async () => {
    const session = spawnScenario({
      steps: [{ idle: true }],
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          setTimeout(() => session.sendInput("hello"), 0);
        }
      }
    })();

    await streamDone;
    const types = events.map((e) => e.type);

    expect(types).toEqual([
      "system",
      "runtime_session_id",
      "status",     // waiting_input
      "status",     // running
      "text",       // echo
      "status",     // completed
    ]);
    expect(events[4].content).toBe("You said: hello");
    expect(events[5].content).toBe("completed");
  });

  it("on_input 'fail' causes failure on input", async () => {
    const session = spawnScenario({
      steps: [
        { on_input: "fail" },
        { idle: true },
      ],
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          setTimeout(() => session.sendInput("anything"), 0);
        }
      }
    })();

    await streamDone;

    const lastStatus = events.filter((e) => e.type === "status").pop()!;
    expect(lastStatus.content).toBe("failed");
    expect(session.status).toBe("stopped");
  });

  it("on_input 'next' silently advances past idle", async () => {
    const session = spawnScenario({
      steps: [
        { on_input: "next" },
        { idle: true },
        { emit: "text", content: "after idle" },
      ],
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          setTimeout(() => session.sendInput("go"), 0);
        }
      }
    })();

    await streamDone;

    // Should have the "after idle" text event and no "You said:" echo
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].content).toBe("after idle");
  });

  it("on_input 'ignore' silently continues past idle without echo", async () => {
    const session = spawnScenario({
      steps: [
        { on_input: "ignore" },
        { idle: true },
        { emit: "text", content: "continued" },
      ],
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          setTimeout(() => session.sendInput("anything"), 0);
        }
      }
    })();

    await streamDone;

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].content).toBe("continued");
  });

  it("on_input_match routes different inputs to different actions", async () => {
    const session = spawnScenario({
      steps: [
        { on_input_match: { fail: "fail", continue: "next", "*": "echo" } },
        { idle: true },
      ],
    });

    // Test with "continue" — should use "next" action
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

    // "next" action → no echo, continues to completed
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(0);
    expect(events[events.length - 1].content).toBe("completed");
  });

  it("on_input_match with '*' fallback echoes unmatched input", async () => {
    const session = spawnScenario({
      steps: [
        { on_input_match: { fail: "fail", "*": "echo" } },
        { idle: true },
      ],
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          setTimeout(() => session.sendInput("something random"), 0);
        }
      }
    })();

    await streamDone;

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].content).toBe("You said: something random");
  });

  it("wait step delays execution", async () => {
    const start = Date.now();
    const session = spawnScenario({
      steps: [
        { emit: "text", content: "before" },
        { wait: 50 },
        { emit: "text", content: "after" },
      ],
    });

    const events = await collectEvents(session);
    const elapsed = Date.now() - start;

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(2);
    expect(textEvents[0].content).toBe("before");
    expect(textEvents[1].content).toBe("after");
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timing variance
  });

  it("kill during wait step terminates early", async () => {
    const session = spawnScenario({
      steps: [
        { emit: "text", content: "before" },
        { wait: 5000 },
        { emit: "text", content: "never reached" },
      ],
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "text" && event.content === "before") {
          // Kill after a short delay (well before the 5000ms wait completes)
          setTimeout(() => session.kill(), 10);
        }
      }
    })();

    await streamDone;

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].content).toBe("before");

    const lastStatus = events[events.length - 1];
    expect(lastStatus.type).toBe("status");
    expect(lastStatus.content).toBe("killed");
    expect(session.status).toBe("stopped");
  });

  it("kill during idle step terminates early", async () => {
    const session = spawnScenario({
      steps: [{ idle: true }],
    });

    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          // Use setTimeout to avoid killing synchronously inside the iterator callback
          setTimeout(() => session.kill(), 0);
        }
      }
    })();

    await streamDone;

    const statusEvents = events.filter((e) => e.type === "status");
    expect(statusEvents).toHaveLength(2);
    expect(statusEvents[0].content).toBe("waiting_input");
    expect(statusEvents[1].content).toBe("killed");
  });

  it("finding and subtask_create emit steps produce correct event types", async () => {
    const session = spawnScenario({
      steps: [
        { emit: "finding", content: "Found a bug in auth.ts" },
        { emit: "subtask_create", title: "Fix the bug", description: "Fix auth.ts line 42" },
      ],
    });

    const events = await collectEvents(session);

    const findingEvent = events.find((e) => e.type === "finding")!;
    expect(findingEvent).toBeDefined();
    expect(findingEvent.content).toBe("Found a bug in auth.ts");

    const subtaskEvent = events.find((e) => e.type === "subtask_create")!;
    expect(subtaskEvent).toBeDefined();
    expect(JSON.parse(subtaskEvent.content)).toEqual({
      title: "Fix the bug",
      description: "Fix auth.ts line 42",
    });
  });

  it("usage event is emitted correctly", async () => {
    const usageData = JSON.stringify({ inputTokens: 100, outputTokens: 50 });
    const session = spawnScenario({
      steps: [{ emit: "usage", content: usageData }],
    });

    const events = await collectEvents(session);
    const usageEvent = events.find((e) => e.type === "usage")!;
    expect(usageEvent).toBeDefined();
    expect(usageEvent.content).toBe(usageData);
  });

  it("SCENARIO: prefix in task-style prompt is detected", async () => {
    const runtime = new StubRuntime();
    const scenario = { steps: [{ emit: "text", content: "from scenario" }] };
    const session = runtime.spawn({
      sessionId: "prefix-test",
      prompt: `My Task Title\n\nSCENARIO: ${JSON.stringify(scenario)}`,
      model: "m",
      maxTurns: 1,
    });

    const events = await collectEvents(session);
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].content).toBe("from scenario");
  });

  it("non-scenario prompt still uses legacy echo behavior", async () => {
    const runtime = new StubRuntime();
    const session = runtime.spawn({
      sessionId: "legacy-check",
      prompt: "plain text prompt",
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

    // Should have legacy echo behavior
    const textEvent = events.find((e) => e.type === "text")!;
    expect(textEvent.content).toBe("Echo: plain text prompt");
  });

  it("multiple idle steps with changing input handlers", async () => {
    const session = spawnScenario({
      steps: [
        { on_input: "next" },
        { idle: true },
        { on_input: "echo" },
        { idle: true },
      ],
    });

    let idleCount = 0;
    const events: AgentEvent[] = [];
    const streamDone = (async () => {
      for await (const event of session.stream()) {
        events.push(event);
        if (event.type === "status" && event.content === "waiting_input") {
          idleCount++;
          setTimeout(() => session.sendInput(`input-${idleCount}`), 0);
        }
      }
    })();

    await streamDone;

    // First idle: on_input "next" → no echo
    // Second idle: on_input "echo" → echoes
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].content).toBe("You said: input-2");
  });
});
