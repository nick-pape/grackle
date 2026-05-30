/**
 * Tests for `mapAgentEvent` — AgentEvent → AHP SessionAction mapping.
 *
 * Each test covers one AgentEvent type and verifies:
 * 1. Correct AHP action(s) are produced
 * 2. Mapper context is updated correctly
 * 3. Mapping notes have the right disposition
 */

import { describe, it, expect } from "vitest";
import { ActionType } from "@grackle-ai/ahp";
import { mapAgentEvent, type AgentEventFields, type MapperContext } from "./ahp-mapper.js";

// ─── Helpers ────────────────────────────────────────────────────────

function makeContext(overrides?: Partial<MapperContext>): MapperContext {
  return {
    turnId: undefined,
    openToolCalls: [],
    partCounter: 0,
    eventIndex: 0,
    metaAccumulator: {},
    ...overrides,
  };
}

function makeEvent(type: string, overrides?: Record<string, unknown>): AgentEventFields {
  return {
    type,
    content: overrides?.content as string | undefined,
    toolCallId: overrides?.toolCallId as string | undefined,
    turnId: overrides?.turnId as string | undefined,
    diagnostic: overrides?.diagnostic as boolean | undefined,
    toolError: overrides?.toolError as boolean | undefined,
  };
}

function assertActionType<T extends { type: string }>(
  actions: unknown[],
  expectedType: string,
  index: number = 0,
): T {
  const action = actions[index] as T;
  expect(action.type).toBe(expectedType);
  return action;
}

// ─── turn_started ──────────────────────────────────────────────────

describe("turn_started", () => {
  it("maps to SessionTurnStarted with message", () => {
    const context = makeContext();
    const event = makeEvent("turn_started", {
      turnId: "turn-abc",
      content: JSON.stringify({ user_message: "Hello world" }),
    });
    const result = mapAgentEvent(event, 0, context);

    expect(result.actions.length).toBe(1);
    const action = assertActionType<{
      type: string;
      turnId: string;
      message: { text: string };
    }>(result.actions, ActionType.SessionTurnStarted);
    expect(action.turnId).toBe("turn-abc");
    expect(action.message.text).toBe("Hello world");
    expect(context.turnId).toBe("turn-abc");
    expect(context.openToolCalls).toEqual([]);
    expect(result.note?.disposition).toBe("mapped");
  });

  it("uses generated turnId when none provided", () => {
    const context = makeContext();
    const event = makeEvent("turn_started", {
      content: JSON.stringify({ user_message: "Prompt" }),
    });
    const result = mapAgentEvent(event, 0, context);

    expect(result.actions.length).toBe(1);
    const action = assertActionType<{ type: string; turnId: string }>(
      result.actions,
      ActionType.SessionTurnStarted,
    );
    expect(action.turnId).toBe("turn-0");
    expect(context.turnId).toBe("turn-0");
  });

  it("resets openToolCalls on new turn", () => {
    const context = makeContext({ openToolCalls: ["old-tc-1", "old-tc-2"] });
    const event = makeEvent("turn_started", {
      turnId: "turn-new",
      content: JSON.stringify({ user_message: "New turn" }),
    });
    mapAgentEvent(event, 0, context);
    expect(context.openToolCalls).toEqual([]);
  });
});

// ─── turn_complete ─────────────────────────────────────────────────

describe("turn_complete", () => {
  it("maps to SessionTurnComplete when turn is active", () => {
    const context = makeContext({ turnId: "turn-abc" });
    const event = makeEvent("turn_complete", { turnId: "turn-abc" });
    const result = mapAgentEvent(event, 1, context);

    expect(result.actions.length).toBe(1);
    assertActionType<{ type: string; turnId: string }>(
      result.actions,
      ActionType.SessionTurnComplete,
    );
    expect(context.turnId).toBeUndefined();
    expect(context.openToolCalls).toEqual([]);
    expect(result.note?.disposition).toBe("mapped");
  });

  it("drops when no active turn", () => {
    const context = makeContext();
    const event = makeEvent("turn_complete");
    const result = mapAgentEvent(event, 1, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
  });
});

// ─── input_needed ──────────────────────────────────────────────────

describe("input_needed", () => {
  it("drops as advisory only", () => {
    const context = makeContext();
    const event = makeEvent("input_needed");
    const result = mapAgentEvent(event, 2, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
    expect(result.note?.detail).toContain("Advisory event");
  });
});

// ─── text ──────────────────────────────────────────────────────────

describe("text", () => {
  it("maps to SessionResponsePart(markdown) with turn", () => {
    const context = makeContext({ turnId: "turn-abc", partCounter: 5 });
    const event = makeEvent("text", { content: "Hello there" });
    const result = mapAgentEvent(event, 3, context);

    expect(result.actions.length).toBe(1);
    const action = assertActionType<{
      type: string;
      turnId: string;
      part: { kind: string; id: string; content: string };
    }>(result.actions, ActionType.SessionResponsePart);
    expect(action.part.kind).toBe("markdown");
    expect(action.part.id).toBe("part-5");
    expect(action.part.content).toBe("Hello there");
    expect(result.note?.disposition).toBe("mapped");
  });

  it("drops when no active turn", () => {
    const context = makeContext();
    const event = makeEvent("text", { content: "Hello" });
    const result = mapAgentEvent(event, 3, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
  });
});

// ─── tool_use ──────────────────────────────────────────────────────

describe("tool_use", () => {
  it("maps to SessionToolCallStart + SessionToolCallReady", () => {
    const context = makeContext({ turnId: "turn-abc", partCounter: 10 });
    const event = makeEvent("tool_use", {
      toolCallId: "tc-xyz",
      content: JSON.stringify({
        tool_name: "read_file",
        display_name: "Read File",
      }),
    });
    const result = mapAgentEvent(event, 4, context);

    expect(result.actions.length).toBe(2);
    const start = assertActionType<{
      type: string;
      turnId: string;
      toolCallId: string;
      toolName: string;
      displayName: string;
    }>(result.actions, ActionType.SessionToolCallStart);
    expect(start.toolCallId).toBe("tc-xyz");
    expect(start.toolName).toBe("read_file");
    expect(start.displayName).toBe("Read File");

    const ready = assertActionType<{
      type: string;
      turnId: string;
      toolCallId: string;
      invocationMessage: string;
      confirmed: string;
    }>(result.actions, ActionType.SessionToolCallReady, 1);
    expect(ready.toolCallId).toBe("tc-xyz");
    expect(ready.confirmed).toBe("not-needed");

    expect(context.openToolCalls).toEqual(["tc-xyz"]);
    expect(result.note ? 1 : 0).toBe(1);
    expect(result.note?.disposition).toBe("mapped");
  });

  it("generates toolCallId when none provided", () => {
    const context = makeContext({ turnId: "turn-abc", partCounter: 10 });
    const event = makeEvent("tool_use", {
      content: JSON.stringify({ tool_name: "shell" }),
    });
    mapAgentEvent(event, 4, context);
    expect(context.openToolCalls).toEqual(["tc-10"]);
  });

  it("drops when no active turn", () => {
    const context = makeContext();
    const event = makeEvent("tool_use", { content: "{}" });
    const result = mapAgentEvent(event, 4, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
  });
});

// ─── tool_result ───────────────────────────────────────────────────

describe("tool_result", () => {
  it("pairs by toolCallId and maps to SessionToolCallComplete", () => {
    const context = makeContext({
      turnId: "turn-abc",
      openToolCalls: ["tc-xyz"],
    });
    const event = makeEvent("tool_result", {
      toolCallId: "tc-xyz",
      content: JSON.stringify({ is_ok: true, content: "file contents here" }),
    });
    const result = mapAgentEvent(event, 5, context);

    // Successful result produces: Complete + systemNotification
    expect(result.actions.length).toBe(2);
    const complete = assertActionType<{
      type: string;
      turnId: string;
      toolCallId: string;
      result: {
        success: boolean;
        pastTenseMessage: string;
        content?: Array<{ type: string; text: string }>;
      };
    }>(result.actions, ActionType.SessionToolCallComplete);
    expect(complete.toolCallId).toBe("tc-xyz");
    expect(complete.result.success).toBe(true);

    // First-class toolCallId (HR3) is used; matched id is removed from LIFO stack
    expect(context.openToolCalls).toEqual([]);
    expect(result.note?.disposition).toBe("mapped");
  });

  it("pairs by LIFO stack when no toolCallId", () => {
    const context = makeContext({
      turnId: "turn-abc",
      openToolCalls: ["tc-first", "tc-last"],
    });
    const event = makeEvent("tool_result", {
      content: JSON.stringify({ is_ok: true, content: "result" }),
    });
    mapAgentEvent(event, 5, context);

    // Should pop "tc-last" (LIFO)
    expect(context.openToolCalls).toEqual(["tc-first"]);
  });

  it("synthesizes a toolCallId when no matching tool call (HR8d)", () => {
    // Pre-HR8d this dropped. Now: emit SessionToolCallComplete with a
    // synthesized `tc-orphan-result-N` so the gRPC unpaired-tool_result
    // behavior survives the wire flip (the consumer's reverse mapper
    // emits a tool_result event, the UI's pairToolEvents finds no match
    // in toolUseById and renders it via the unpaired GenericToolCard).
    const context = makeContext({ turnId: "turn-abc", openToolCalls: [], partCounter: 0 });
    const event = makeEvent("tool_result", { content: "{}" });
    const result = mapAgentEvent(event, 5, context);

    expect(result.note?.disposition).toBe("mapped");
    expect(result.actions.length).toBeGreaterThan(0);
    const complete = result.actions.find((a) => a.type === ActionType.SessionToolCallComplete) as
      | { toolCallId: string }
      | undefined;
    expect(complete).toBeDefined();
    expect(complete!.toolCallId).toMatch(/^tc-orphan-result-/);
  });

  it("adds system notification for successful result", () => {
    const context = makeContext({
      turnId: "turn-abc",
      openToolCalls: ["tc-xyz"],
    });
    const event = makeEvent("tool_result", {
      toolCallId: "tc-xyz",
      content: "Success: file written",
    });
    const result = mapAgentEvent(event, 5, context);

    expect(result.actions.length).toBe(2);
    expect(result.note).toBeDefined();
    expect(result.note?.disposition).toBe("mapped");
  });

  it("drops when no active turn", () => {
    const context = makeContext({ openToolCalls: ["tc-xyz"] });
    const event = makeEvent("tool_result", { toolCallId: "tc-xyz", content: "{}" });
    const result = mapAgentEvent(event, 5, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
  });
});

// ─── usage ─────────────────────────────────────────────────────────

describe("usage", () => {
  it("carries cost_millicents into metaAccumulator", () => {
    const context = makeContext({
      metaAccumulator: { costMillicents: 100 },
    });
    const event = makeEvent("usage", {
      content: JSON.stringify({ cost_millicents: 50 }),
    });
    const result = mapAgentEvent(event, 6, context);

    expect(context.metaAccumulator.costMillicents).toBe(150);
    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("carried");
  });

  it("ignores non-finite cost_millicents", () => {
    const context = makeContext();
    const event = makeEvent("usage", {
      content: JSON.stringify({ cost_millicents: NaN }),
    });
    mapAgentEvent(event, 6, context);
    expect(context.metaAccumulator.costMillicents).toBeUndefined();
  });

  it("handles zero cost_millicents without breaking accumulator", () => {
    const context = makeContext({ metaAccumulator: { costMillicents: 100 } });
    const event = makeEvent("usage", {
      content: JSON.stringify({ cost_millicents: 0 }),
    });
    mapAgentEvent(event, 6, context);
    // 0 is a valid (non-null) cost — accumulator should be 100 + 0 = 100
    expect(context.metaAccumulator.costMillicents).toBe(100);
  });

  // HR8d follow-up #1355: input/output token plumbing
  it("carries input_tokens / output_tokens into metaAccumulator alongside cost (HR8d follow-up #1355)", () => {
    const context = makeContext({
      metaAccumulator: { costMillicents: 100, inputTokens: 50, outputTokens: 10 },
    });
    const event = makeEvent("usage", {
      content: JSON.stringify({ cost_millicents: 20, input_tokens: 5, output_tokens: 3 }),
    });
    mapAgentEvent(event, 6, context);
    expect(context.metaAccumulator.costMillicents).toBe(120);
    expect(context.metaAccumulator.inputTokens).toBe(55);
    expect(context.metaAccumulator.outputTokens).toBe(13);
  });

  it("ignores non-finite input_tokens / output_tokens (HR8d follow-up #1355)", () => {
    const context = makeContext();
    const event = makeEvent("usage", {
      content: JSON.stringify({ input_tokens: NaN, output_tokens: "abc" }),
    });
    mapAgentEvent(event, 6, context);
    expect(context.metaAccumulator.inputTokens).toBeUndefined();
    expect(context.metaAccumulator.outputTokens).toBeUndefined();
  });

  it("accumulates input_tokens / output_tokens with zero increments (HR8d follow-up #1355)", () => {
    const context = makeContext({ metaAccumulator: { inputTokens: 7, outputTokens: 11 } });
    const event = makeEvent("usage", {
      content: JSON.stringify({ input_tokens: 0, output_tokens: 0 }),
    });
    mapAgentEvent(event, 6, context);
    expect(context.metaAccumulator.inputTokens).toBe(7);
    expect(context.metaAccumulator.outputTokens).toBe(11);
  });

  it("usage event with only token fields (no cost) still updates accumulator (HR8d follow-up #1355)", () => {
    const context = makeContext();
    const event = makeEvent("usage", {
      content: JSON.stringify({ input_tokens: 42, output_tokens: 11 }),
    });
    mapAgentEvent(event, 6, context);
    expect(context.metaAccumulator.costMillicents).toBeUndefined();
    expect(context.metaAccumulator.inputTokens).toBe(42);
    expect(context.metaAccumulator.outputTokens).toBe(11);
  });
});

// ─── error ─────────────────────────────────────────────────────────

describe("error", () => {
  it("maps to SessionError when in-turn", () => {
    const context = makeContext({ turnId: "turn-abc" });
    const event = makeEvent("error", { content: "Something went wrong" });
    const result = mapAgentEvent(event, 7, context);

    expect(result.actions.length).toBe(1);
    const action = assertActionType<{
      type: string;
      turnId: string;
      error: { message: string };
    }>(result.actions, ActionType.SessionError);
    expect(action.turnId).toBe("turn-abc");
    expect(action.error.message).toBe("Something went wrong");
    expect(result.note?.disposition).toBe("mapped");
    // context.turnId must be cleared so subsequent events aren't mapped to the defunct turn
    expect(context.turnId).toBeUndefined();
  });

  it("clears context.turnId so subsequent text events are dropped after in-turn error", () => {
    const context = makeContext({ turnId: "turn-abc" });
    mapAgentEvent(makeEvent("error", { content: "Oops" }), 7, context);

    const textResult = mapAgentEvent(makeEvent("text", { content: "After error" }), 8, context);
    expect(textResult.actions.length).toBe(0);
    expect(textResult.note?.disposition).toBe("dropped");
  });

  it("maps to SessionCreationFailed when pre-turn", () => {
    const context = makeContext();
    const event = makeEvent("error", { content: "Init failed" });
    const result = mapAgentEvent(event, 7, context);

    expect(result.actions.length).toBe(1);
    const action = assertActionType<{
      type: string;
      error: { message: string };
    }>(result.actions, ActionType.SessionCreationFailed);
    expect(action.error.message).toBe("Init failed");
    expect(result.note?.disposition).toBe("mapped");
  });
});

// ─── status ────────────────────────────────────────────────────────

describe("status", () => {
  it("maps failed to SessionError when in-turn", () => {
    const context = makeContext({ turnId: "turn-abc" });
    const event = makeEvent("status", { content: "failed" });
    const result = mapAgentEvent(event, 8, context);

    expect(result.actions.length).toBe(1);
    assertActionType<{ type: string }>(result.actions, ActionType.SessionError);
    expect(context.turnId).toBeUndefined();
    expect(result.note?.disposition).toBe("mapped");
  });

  it("maps failed to SessionCreationFailed when pre-turn", () => {
    const context = makeContext();
    const event = makeEvent("status", { content: "failed" });
    const result = mapAgentEvent(event, 8, context);

    expect(result.actions.length).toBe(1);
    assertActionType<{ type: string }>(result.actions, ActionType.SessionCreationFailed);
    expect(result.note?.disposition).toBe("mapped");
  });

  it("maps killed to SessionError when in-turn", () => {
    const context = makeContext({ turnId: "turn-abc", openToolCalls: ["tc-1"] });
    const event = makeEvent("status", { content: "killed" });
    const result = mapAgentEvent(event, 9, context);

    expect(result.actions.length).toBe(1);
    assertActionType<{ type: string }>(result.actions, ActionType.SessionError);
    expect(context.turnId).toBeUndefined();
    expect(context.openToolCalls).toEqual([]);
  });

  it("drops killed when no active turn", () => {
    const context = makeContext();
    const event = makeEvent("status", { content: "killed" });
    const result = mapAgentEvent(event, 9, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
  });

  it("drops completed/waiting_input/running", () => {
    for (const status of ["completed", "waiting_input", "running"]) {
      const context = makeContext({ turnId: "turn-abc" });
      const event = makeEvent("status", { content: status });
      const result = mapAgentEvent(event, 10, context);

      expect(result.actions.length).toBe(0);
      expect(result.note?.disposition).toBe("dropped");
    }
  });
});

// ─── system ────────────────────────────────────────────────────────

describe("system", () => {
  it("maps non-diagnostic system to SessionResponsePart(systemNotification)", () => {
    const context = makeContext({ turnId: "turn-abc", partCounter: 20 });
    const event = makeEvent("system", { content: "Subagent completed" });
    const result = mapAgentEvent(event, 11, context);

    expect(result.actions.length).toBe(1);
    const action = assertActionType<{
      type: string;
      part: { kind: string; content: string };
    }>(result.actions, ActionType.SessionResponsePart);
    expect(action.part.kind).toBe("systemNotification");
    expect(action.part.content).toBe("Subagent completed");
    expect(result.note?.disposition).toBe("mapped");
  });

  it("drops diagnostic system events", () => {
    const context = makeContext();
    const event = makeEvent("system", {
      diagnostic: true,
      content: JSON.stringify({ level: "info", msg: "diagnostic" }),
    });
    const result = mapAgentEvent(event, 12, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("carried");
    expect(result.note?.detail).toContain("diagnostic");
  });

  it("drops non-diagnostic system when no active turn", () => {
    const context = makeContext();
    const event = makeEvent("system", { content: "Subagent completed" });
    const result = mapAgentEvent(event, 11, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
  });
});

// ─── runtime_session_id ────────────────────────────────────────────

describe("runtime_session_id", () => {
  it("carries content into metaAccumulator", () => {
    const context = makeContext();
    const event = makeEvent("runtime_session_id", { content: "runtime-abc-123" });
    const result = mapAgentEvent(event, 13, context);

    expect(context.metaAccumulator.runtimeSessionId).toBe("runtime-abc-123");
    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("carried");
  });

  it("drops when no content", () => {
    const context = makeContext();
    const event = makeEvent("runtime_session_id");
    const result = mapAgentEvent(event, 13, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
  });
});

// ─── Unknown event types ──────────────────────────────────────────

describe("unknown event types", () => {
  it("drops unrecognized event types", () => {
    const context = makeContext();
    const event = makeEvent("unknown_weird_type");
    const result = mapAgentEvent(event, 100, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
    expect(result.note?.detail).toContain("Unrecognized event type");
  });
});

// ─── Context mutation tests ────────────────────────────────────────

describe("context mutation", () => {
  it("partCounter increments across multiple text events", () => {
    const context = makeContext({ turnId: "turn-abc", partCounter: 0 });

    const r1 = mapAgentEvent(makeEvent("text", { content: "A" }), 0, context);
    const r2 = mapAgentEvent(makeEvent("text", { content: "B" }), 1, context);

    expect(r1.actions[0]).toMatchObject({ part: { id: "part-0" } });
    expect(r2.actions[0]).toMatchObject({ part: { id: "part-1" } });
  });

  it("metaAccumulator persists across events", () => {
    const context = makeContext({ metaAccumulator: {} });

    mapAgentEvent(
      makeEvent("usage", { content: JSON.stringify({ cost_millicents: 10 }) }),
      0,
      context,
    );
    mapAgentEvent(
      makeEvent("usage", { content: JSON.stringify({ cost_millicents: 20 }) }),
      1,
      context,
    );

    expect(context.metaAccumulator.costMillicents).toBe(30);
  });
});

// ─── Branch-coverage supplement ────────────────────────────────────
//
// The tests above cover the headline mappings. This block fills in the
// remaining branches (parse fallbacks, ternary "else" arms, missing-field
// paths) so v8 coverage hits the per-package `branches` floor in
// rigs/heft-rig/coverage-thresholds.json.

describe("branch coverage", () => {
  it("turn_started with non-JSON content uses raw content as message", () => {
    const context = makeContext();
    const event = makeEvent("turn_started", { content: "just a plain string", turnId: "t1" });
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as { message: { text: string } };
    expect(action.message.text).toBe("just a plain string");
  });

  it("turn_started with empty content yields empty message text", () => {
    const context = makeContext();
    const event = makeEvent("turn_started", { turnId: "t1" });
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as { message: { text: string } };
    expect(action.message.text).toBe("");
  });

  it("text with no content emits empty markdown part", () => {
    const context = makeContext({ turnId: "t1", partCounter: 0 });
    const event = makeEvent("text");
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as { part: { content: string } };
    expect(action.part.content).toBe("");
  });

  it("tool_use with non-JSON content falls back to unknown_tool / generated invocation", () => {
    const context = makeContext({ turnId: "t1", partCounter: 0 });
    const event = makeEvent("tool_use", { content: "not json" });
    const result = mapAgentEvent(event, 0, context);

    const start = result.actions[0] as { toolName: string; displayName: string };
    const ready = result.actions[1] as { invocationMessage: string };
    expect(start.toolName).toBe("unknown_tool");
    expect(start.displayName).toBe("unknown_tool");
    expect(ready.invocationMessage).toBe("Running unknown_tool");
  });

  it("tool_use accepts `name` field when `tool_name` is absent", () => {
    const context = makeContext({ turnId: "t1", partCounter: 0 });
    const event = makeEvent("tool_use", { content: JSON.stringify({ name: "shell" }) });
    const result = mapAgentEvent(event, 0, context);

    const start = result.actions[0] as { toolName: string };
    expect(start.toolName).toBe("shell");
  });

  it("tool_use falls back to toolName when display_name is absent", () => {
    const context = makeContext({ turnId: "t1", partCounter: 0 });
    const event = makeEvent("tool_use", { content: JSON.stringify({ tool_name: "edit" }) });
    const result = mapAgentEvent(event, 0, context);

    const start = result.actions[0] as { displayName: string };
    expect(start.displayName).toBe("edit");
  });

  it("tool_use uses provided invocation_message when present", () => {
    const context = makeContext({ turnId: "t1", partCounter: 0 });
    const event = makeEvent("tool_use", {
      content: JSON.stringify({ tool_name: "shell", invocation_message: "running shell `ls`" }),
    });
    const result = mapAgentEvent(event, 0, context);

    const ready = result.actions[1] as { invocationMessage: string };
    expect(ready.invocationMessage).toBe("running shell `ls`");
  });

  it("tool_use accepts the legacy `tool` field as a toolName alias (HR8d)", () => {
    // Stub fixtures and Claude Code's tool_use events both serialize as
    // `{tool, args}` rather than `{tool_name}`. Without the `tool` alias the
    // forward mapper falls through to "unknown_tool" and the consumer sees
    // a degraded tool card.
    const context = makeContext({ turnId: "t1", partCounter: 0 });
    const event = makeEvent("tool_use", { content: JSON.stringify({ tool: "echo", args: {} }) });
    const result = mapAgentEvent(event, 0, context);

    const start = result.actions[0] as { toolName: string };
    expect(start.toolName).toBe("echo");
  });

  it("tool_use packs `args` into SessionToolCallReady.toolInput (HR8d)", () => {
    const context = makeContext({ turnId: "t1", partCounter: 0 });
    const event = makeEvent("tool_use", {
      content: JSON.stringify({ tool: "echo", args: { message: "hello" } }),
    });
    const result = mapAgentEvent(event, 0, context);

    const ready = result.actions[1] as { toolInput?: string };
    expect(ready.toolInput).toBeDefined();
    expect(JSON.parse(ready.toolInput!)).toEqual({ message: "hello" });
  });

  it("tool_use packs `input` and `arguments` as toolInput aliases (HR8d)", () => {
    // Claude Code emits `input` on some paths; Copilot emits `arguments`.
    const ctx1 = makeContext({ turnId: "t1", partCounter: 0 });
    const ev1 = makeEvent("tool_use", {
      content: JSON.stringify({ tool: "bash", input: { command: "ls" } }),
    });
    const r1 = mapAgentEvent(ev1, 0, ctx1);
    const ready1 = r1.actions[1] as { toolInput?: string };
    expect(JSON.parse(ready1.toolInput!)).toEqual({ command: "ls" });

    const ctx2 = makeContext({ turnId: "t1", partCounter: 0 });
    const ev2 = makeEvent("tool_use", {
      content: JSON.stringify({ tool: "search", arguments: { query: "foo" } }),
    });
    const r2 = mapAgentEvent(ev2, 0, ctx2);
    const ready2 = r2.actions[1] as { toolInput?: string };
    expect(JSON.parse(ready2.toolInput!)).toEqual({ query: "foo" });
  });

  it("tool_use omits toolInput when no args are present (HR8d)", () => {
    const context = makeContext({ turnId: "t1", partCounter: 0 });
    const event = makeEvent("tool_use", { content: JSON.stringify({ tool: "ping" }) });
    const result = mapAgentEvent(event, 0, context);

    const ready = result.actions[1] as { toolInput?: string };
    expect(ready.toolInput).toBeUndefined();
  });

  it("tool_result with is_ok:false emits failure result with error", () => {
    const context = makeContext({ turnId: "t1", openToolCalls: ["tc-1"] });
    const event = makeEvent("tool_result", {
      toolCallId: "tc-1",
      content: JSON.stringify({ is_ok: false, past_tense_message: "failed to read" }),
    });
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as {
      result: { success: boolean; content?: unknown; error?: { message: string } };
    };
    expect(action.result.success).toBe(false);
    expect(action.result.content).toBeUndefined();
    expect(action.result.error?.message).toBe("failed to read");
    // No system notification on failure
    expect(result.actions.length).toBe(1);
  });

  it("tool_result accepts `success` field when `is_ok` is absent", () => {
    const context = makeContext({ turnId: "t1", openToolCalls: ["tc-1"] });
    const event = makeEvent("tool_result", {
      toolCallId: "tc-1",
      content: JSON.stringify({ success: false, content: "nope" }),
    });
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as { result: { success: boolean } };
    expect(action.result.success).toBe(false);
  });

  it("tool_result defaults to success=true when neither is_ok nor success present", () => {
    const context = makeContext({ turnId: "t1", openToolCalls: ["tc-1"] });
    const event = makeEvent("tool_result", {
      toolCallId: "tc-1",
      content: JSON.stringify({ content: "ok" }),
    });
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as { result: { success: boolean } };
    expect(action.result.success).toBe(true);
  });

  it("tool_result with non-JSON content keeps default success=true (no toolError field)", () => {
    // Fallback path: when the first-class `toolError` field is absent AND the
    // content isn't structured JSON, default to success.
    const context = makeContext({ turnId: "t1", openToolCalls: ["tc-1"] });
    const event = makeEvent("tool_result", { toolCallId: "tc-1", content: "raw text result" });
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as { result: { success: boolean; pastTenseMessage: string } };
    expect(action.result.success).toBe(true);
    expect(action.result.pastTenseMessage).toBe("raw text result");
  });

  // ─── #1362: first-class toolError field is authoritative ──────────────
  // Real runtimes (Claude Code, Copilot, Codex, ACP) carry the failure flag in
  // `raw`, never in `content` — which the AHP wire drops. The producer lifts it
  // to `toolError`; the mapper MUST read that, not the (always-absent) content
  // `is_ok`. This is the regression #1359 left unaddressed on the producer side.

  it("tool_result with toolError:true maps to success=false even with plain-text content", () => {
    const context = makeContext({ turnId: "t1", openToolCalls: ["tc-1"] });
    const event = makeEvent("tool_result", {
      toolCallId: "tc-1",
      content: "bash: command not found",
      toolError: true,
    });
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as {
      result: { success: boolean; error?: { message: string }; content?: unknown };
    };
    expect(action.result.success).toBe(false);
    expect(action.result.error?.message).toBe("bash: command not found");
    // No success-only system notification when the tool failed
    expect(result.actions.length).toBe(1);
  });

  it("tool_result with toolError:false maps to success=true", () => {
    const context = makeContext({ turnId: "t1", openToolCalls: ["tc-1"] });
    const event = makeEvent("tool_result", {
      toolCallId: "tc-1",
      content: "file written",
      toolError: false,
    });
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as { result: { success: boolean } };
    expect(action.result.success).toBe(true);
  });

  it("toolError field overrides a conflicting content is_ok flag", () => {
    // The first-class field wins over content — guards against a runtime whose
    // output text happens to contain a misleading `is_ok` key.
    const context = makeContext({ turnId: "t1", openToolCalls: ["tc-1"] });
    const event = makeEvent("tool_result", {
      toolCallId: "tc-1",
      content: JSON.stringify({ is_ok: true, content: "looks ok but failed" }),
      toolError: true,
    });
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as { result: { success: boolean } };
    expect(action.result.success).toBe(false);
  });

  it("tool_result with no content emits no system notification", () => {
    const context = makeContext({ turnId: "t1", openToolCalls: ["tc-1"] });
    const event = makeEvent("tool_result", { toolCallId: "tc-1" });
    const result = mapAgentEvent(event, 0, context);

    expect(result.actions.length).toBe(1);
  });

  it("tool_result with content > 200 chars truncates the system notification", () => {
    const context = makeContext({ turnId: "t1", openToolCalls: ["tc-1"] });
    const longText = "x".repeat(250);
    const event = makeEvent("tool_result", {
      toolCallId: "tc-1",
      content: JSON.stringify({ is_ok: true, content: longText }),
    });
    const result = mapAgentEvent(event, 0, context);

    const notification = result.actions[1] as { part: { content: string } };
    expect(notification.part.content.length).toBe(203); // 200 chars + "..."
    expect(notification.part.content.endsWith("...")).toBe(true);
  });

  it("usage with null cost_millicents leaves accumulator untouched", () => {
    const context = makeContext({ metaAccumulator: { costMillicents: 50 } });
    const event = makeEvent("usage", { content: JSON.stringify({ cost_millicents: null }) });
    mapAgentEvent(event, 0, context);

    expect(context.metaAccumulator.costMillicents).toBe(50);
  });

  it("usage with no parsed content leaves accumulator untouched", () => {
    const context = makeContext({ metaAccumulator: { costMillicents: 50 } });
    const event = makeEvent("usage");
    mapAgentEvent(event, 0, context);

    expect(context.metaAccumulator.costMillicents).toBe(50);
  });

  it("error with no content falls back to 'Unknown error'", () => {
    const context = makeContext({ turnId: "t1" });
    const event = makeEvent("error");
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as { error: { message: string } };
    expect(action.error.message).toBe("Unknown error");
  });

  it("status with unknown content is dropped", () => {
    const context = makeContext({ turnId: "t1" });
    const event = makeEvent("status", { content: "made_up_status" });
    const result = mapAgentEvent(event, 0, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
    expect(result.note?.detail).toContain("unrecognized");
  });

  it("status with no content is dropped (empty default branch)", () => {
    const context = makeContext({ turnId: "t1" });
    const event = makeEvent("status");
    const result = mapAgentEvent(event, 0, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
  });

  it("status terminated maps to SessionError when in-turn", () => {
    const context = makeContext({ turnId: "t1", openToolCalls: ["tc-1"] });
    const event = makeEvent("status", { content: "terminated" });
    const result = mapAgentEvent(event, 0, context);

    expect(result.actions.length).toBe(1);
    const action = result.actions[0] as { type: string };
    expect(action.type).toBe(ActionType.SessionError);
    expect(context.turnId).toBeUndefined();
    expect(context.openToolCalls).toEqual([]);
  });

  it("status terminated drops when no active turn", () => {
    const context = makeContext();
    const event = makeEvent("status", { content: "terminated" });
    const result = mapAgentEvent(event, 0, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
  });

  it("system diagnostic via parsed `span`/`trace`/`level` keys is carried (not mapped)", () => {
    const context = makeContext({ turnId: "t1" });
    const event = makeEvent("system", {
      content: JSON.stringify({ span: "x", trace: "y" }),
    });
    const result = mapAgentEvent(event, 0, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("carried");
  });

  it("system with diagnostic-looking keys but also `text` is treated as user-visible", () => {
    const context = makeContext({ turnId: "t1" });
    const event = makeEvent("system", {
      content: JSON.stringify({ span: "x", text: "user-visible content" }),
    });
    const result = mapAgentEvent(event, 0, context);

    expect(result.actions.length).toBe(1);
    expect(result.note?.disposition).toBe("mapped");
  });

  it("tool_result with explicit toolCallId splices from middle of LIFO stack", () => {
    const context = makeContext({
      turnId: "t1",
      openToolCalls: ["tc-old", "tc-target", "tc-newer"],
    });
    const event = makeEvent("tool_result", {
      toolCallId: "tc-target",
      content: JSON.stringify({ is_ok: true, content: "done" }),
    });
    mapAgentEvent(event, 0, context);

    // Splice removed "tc-target" from the middle, preserving order
    expect(context.openToolCalls).toEqual(["tc-old", "tc-newer"]);
  });

  it("text uses event.turnId when context.turnId is unset", () => {
    const context = makeContext();
    const event = makeEvent("text", { content: "hi", turnId: "from-event" });
    const result = mapAgentEvent(event, 0, context);

    const action = result.actions[0] as { turnId: string };
    expect(action.turnId).toBe("from-event");
  });
});
