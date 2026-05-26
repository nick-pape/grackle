/**
 * Replay test: fold mapped AHP actions through the *vendored* AHP session
 * reducer and assert the reconstructed `SessionState`. A clean reconstruction
 * means Grackle's session model expresses faithfully in AHP's; the carried /
 * unmapped accounting records exactly where it does not.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mapAgentEvents } from "./mapper.js";
import { sessionReducer } from "./vendor/ahp/reducers.js";
import {
  ResponsePartKind,
  ToolCallStatus,
  TurnState,
  SessionStatus,
  SessionLifecycle,
} from "./vendor/ahp/channels-session/state.js";
import type { SessionState } from "./vendor/ahp/channels-session/state.js";
import { makeInitialSessionState, happyPath, errorPath, missingIdFallback, preTurnFailure } from "./fixtures.js";
import type { AgentEvent } from "@grackle-ai/runtime-sdk";
import type { SpawnOptions } from "@grackle-ai/runtime-sdk";

/** Map a Grackle AgentEvent stream and fold it through the AHP session reducer. */
function replay(events: AgentEvent[]): SessionState {
  const { actions } = mapAgentEvents(events);
  let state = makeInitialSessionState();
  for (const action of actions) {
    state = sessionReducer(state, action);
  }
  return state;
}

// The reducer stamps `modifiedAt` with Date.now(); pin it for determinism.
let realNow: typeof Date.now;
beforeEach(() => {
  realNow = Date.now;
  Date.now = () => 9999;
});
afterEach(() => {
  Date.now = realNow;
});

describe("happy path", () => {
  it("reconstructs a single completed turn with text, a completed tool call, and usage", () => {
    const state = replay(happyPath);

    expect(state.turns).toHaveLength(1);
    expect(state.activeTurn).toBeUndefined();
    expect(state.summary.status).toBe(SessionStatus.Idle);

    const turn = state.turns[0];
    expect(turn.state).toBe(TurnState.Complete);

    const markdown = turn.responseParts.filter((p) => p.kind === ResponsePartKind.Markdown) as Array<{ content: string }>;
    expect(markdown.map((p) => p.content)).toEqual(["Hello — I'll take a look.", "Done — it looks fine."]);

    const tools = turn.responseParts.filter((p) => p.kind === ResponsePartKind.ToolCall) as Array<{ toolCall: { status: ToolCallStatus; success?: boolean } }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].toolCall.status).toBe(ToolCallStatus.Completed);
    expect(tools[0].toolCall.success).toBe(true);

    expect(turn.usage).toEqual({ inputTokens: 150, outputTokens: 50, _meta: { cost_millicents: 12 } });
  });

  it("pairs the tool_result by the first-class toolCallId (HR3), not a heuristic", () => {
    const result = mapAgentEvents(happyPath);
    const resultNote = result.notes.find((n) => n.type === "tool_result");
    expect(resultNote?.detail).toContain("by toolCallId (HR3)");
  });

  it("maps turn_started to session/turnStarted with the real prompt as userMessage (HR2)", () => {
    const result = mapAgentEvents(happyPath);
    const turnNote = result.notes.find((n) => n.type === "turn_started");
    expect(turnNote?.disposition).toBe("mapped");
    expect(turnNote?.detail).toContain("HR2");
    // The turn was closed by the real turn_complete (not by a status heuristic).
    const completeNote = result.notes.find((n) => n.type === "turn_complete");
    expect(completeNote?.disposition).toBe("mapped");
    // status=completed is now dropped (redundant with turn events).
    const statusNote = result.notes.find((n) => n.type === "status" && n.detail.includes("redundant"));
    expect(statusNote?.disposition).toBe("dropped");
  });

  it("carries runtime_session_id + usage via extension points and routes the diagnostic system event to telemetry (HR7)", () => {
    const result = mapAgentEvents(happyPath);
    // HR7: the pre-turn "Starting runtime…" diagnostic is now carried to the
    // ahp-otlp telemetry channel, not dropped as an unrepresentable gap.
    expect(result.carried.map((n) => n.type)).toEqual(expect.arrayContaining(["runtime_session_id", "usage", "system"]));
    expect(result.unmapped.some((n) => n.type === "system")).toBe(false);

    const state = replay(happyPath);
    expect(state._meta).toEqual({ runtimeSessionId: "rt-abc-123" });
  });
});

// NOTE: the original "orchestration events" describe block is gone. HR7 Part 1
// (#1305) removed `finding`/`subtask_create` from `AgentEventType`, so those
// streams are now type-impossible — the type system enforces that orchestration
// rides the MCP syscall plane, not the session channel.

describe("error path", () => {
  it("ends the turn in an error state", () => {
    const state = replay(errorPath);
    expect(state.turns).toHaveLength(1);
    expect(state.activeTurn).toBeUndefined();
    expect(state.turns[0].state).toBe(TurnState.Error);
    expect(state.turns[0].error?.message).toBe("boom: the SDK threw");
    expect(state.summary.status & SessionStatus.Error).toBe(SessionStatus.Error);
  });
});

describe("pre-turn failure", () => {
  it("maps a failure that arrives before any turn to session/creationFailed", () => {
    const result = mapAgentEvents(preTurnFailure);
    const failNote = result.notes.find((n) => n.type === "status");
    expect(failNote?.disposition).toBe("mapped");
    expect(failNote?.detail).toContain("creationFailed");

    const state = replay(preTurnFailure);
    expect(state.lifecycle).toBe(SessionLifecycle.CreationFailed);
    expect(state.creationError?.message).toBe("session failed");
    expect(state.turns).toHaveLength(0);
    expect(state.activeTurn).toBeUndefined();
  });
});

describe("HR2 turn events", () => {
  it("drops input_needed as advisory (plumb-only; no structured input requests)", () => {
    const result = mapAgentEvents([
      { type: "turn_started" as const, timestamp: "2026-01-01T00:00:00.000Z", content: "prompt", turnId: "t-1" },
      { type: "turn_complete" as const, timestamp: "2026-01-01T00:00:00.000Z", content: "", turnId: "t-1" },
      { type: "input_needed" as const, timestamp: "2026-01-01T00:00:00.000Z", content: "" },
    ]);
    const inputNote = result.notes.find((n) => n.type === "input_needed");
    expect(inputNote?.disposition).toBe("dropped");
    expect(inputNote?.detail).toContain("advisory");
  });

  it("drops status=waiting_input as redundant with turn_complete (HR2 takes over)", () => {
    const result = mapAgentEvents([
      { type: "turn_started" as const, timestamp: "2026-01-01T00:00:00.000Z", content: "hi", turnId: "t-1" },
      { type: "text" as const, timestamp: "2026-01-01T00:00:00.000Z", content: "response" },
      { type: "turn_complete" as const, timestamp: "2026-01-01T00:00:00.000Z", content: "", turnId: "t-1" },
      { type: "status" as const, timestamp: "2026-01-01T00:00:00.000Z", content: "waiting_input" },
    ]);
    const statusNote = result.notes.find((n) => n.type === "status");
    expect(statusNote?.disposition).toBe("dropped");
    expect(statusNote?.detail).toContain("redundant");
  });
});

describe("missing-id fallback (no toolCallId)", () => {
  it("falls back to last-open pairing when toolCallId is absent and completes the tool call", () => {
    const result = mapAgentEvents(missingIdFallback);
    const resultNote = result.notes.find((n) => n.type === "tool_result");
    // Post-HR3 the fragile heuristic is a defensive fallback, not the norm.
    expect(resultNote?.detail).toContain("last-open fallback");

    const state = replay(missingIdFallback);
    const tools = state.turns[0].responseParts.filter((p) => p.kind === ResponsePartKind.ToolCall) as Array<{ toolCall: { status: ToolCallStatus } }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].toolCall.status).toBe(ToolCallStatus.Completed);
  });
});

describe("realism: a live StubRuntime scenario", () => {
  it("maps a real captured AgentEvent stream without crashing", async (ctx) => {
    // StubRuntime isn't re-exported from the package root, so we reach into the
    // built dist — which requires a prior `rush build` of powerline (CI always
    // builds deps before `rush test`). When vitest runs in isolation with no
    // prior dep build, skip gracefully rather than fail at import time.
    type StubModule = { StubRuntime: new () => { spawn(opts: SpawnOptions): { stream(): AsyncIterable<AgentEvent> } } };
    let mod: StubModule;
    try {
      mod = (await import("@grackle-ai/powerline/dist/runtimes/stub.js")) as StubModule;
    } catch {
      ctx.skip();
      return;
    }
    const runtime = new mod.StubRuntime();
    // Include real HR2 turn events so the scenario reflects production emission.
    const scenario = {
      steps: [
        { emit: "turn_started", content: "do the task" },
        { emit: "text", content: "hi" },
        { emit: "tool_use", tool: "read", args: { p: 1 } },
        { emit: "tool_result", content: "ok" },
        { emit: "usage", content: JSON.stringify({ input_tokens: 5, output_tokens: 5 }) },
        { emit: "turn_complete", content: "" },
      ],
    };
    const session = runtime.spawn({ sessionId: "stub-1", prompt: JSON.stringify(scenario), model: "m", maxTurns: 1 });

    const events: AgentEvent[] = [];
    for await (const event of session.stream()) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);

    const { actions } = mapAgentEvents(events);
    expect(actions.length).toBeGreaterThan(0);

    let state = makeInitialSessionState();
    for (const action of actions) {
      state = sessionReducer(state, action);
    }
    // The stub emits a terminal status, so the turn should have closed cleanly.
    expect(state.turns.length).toBeGreaterThanOrEqual(1);
    expect(state.activeTurn).toBeUndefined();
  });
});
