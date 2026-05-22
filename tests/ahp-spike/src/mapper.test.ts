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
  ToolResultContentType,
  TurnState,
  SessionStatus,
  SessionLifecycle,
} from "./vendor/ahp/channels-session/state.js";
import type { SessionState } from "./vendor/ahp/channels-session/state.js";
import { makeInitialSessionState, happyPath, orchestration, errorPath, acpToolPairing, preTurnFailure } from "./fixtures.js";
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

  it("carries runtime_session_id + usage via extension points and drops the pre-turn system message", () => {
    const result = mapAgentEvents(happyPath);
    expect(result.carried.map((n) => n.type)).toEqual(expect.arrayContaining(["runtime_session_id", "usage"]));
    expect(result.unmapped.some((n) => n.type === "system")).toBe(true);

    const state = replay(happyPath);
    expect(state._meta).toEqual({ runtimeSessionId: "rt-abc-123" });
  });
});

describe("orchestration events (no native AHP action)", () => {
  it("flags finding + subtask_create as carried", () => {
    const result = mapAgentEvents(orchestration);
    expect(result.carried.map((n) => n.type)).toEqual(expect.arrayContaining(["finding", "subtask_create"]));
  });

  it("parks findings in _meta and represents a subtask as a subagent tool result", () => {
    const state = replay(orchestration);

    expect((state._meta?.["findings"] as unknown[]).length).toBe(1);

    const tools = state.turns[0].responseParts.filter((p) => p.kind === ResponsePartKind.ToolCall) as Array<{
      toolCall: { toolName: string; status: ToolCallStatus; content?: Array<{ type: ToolResultContentType; resource?: string }> };
    }>;
    const subtask = tools.find((t) => t.toolCall.toolName === "spawn_subtask");
    expect(subtask).toBeDefined();
    expect(subtask!.toolCall.status).toBe(ToolCallStatus.Completed);
    const content = subtask!.toolCall.content ?? [];
    expect(content[0]?.type).toBe(ToolResultContentType.Subagent);
    expect(content[0]?.resource).toContain("subtask-s1");
  });
});

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

describe("ACP-style tool pairing (no raw id)", () => {
  it("pairs the result by the fragile last-open heuristic and completes the tool call", () => {
    const result = mapAgentEvents(acpToolPairing);
    const resultNote = result.notes.find((n) => n.type === "tool_result");
    expect(resultNote?.detail).toContain("last-open");

    const state = replay(acpToolPairing);
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
    const scenario = {
      steps: [
        { emit: "text", content: "hi" },
        { emit: "tool_use", tool: "read", args: { p: 1 } },
        { emit: "tool_result", content: "ok" },
        { emit: "usage", content: JSON.stringify({ input_tokens: 5, output_tokens: 5 }) },
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
