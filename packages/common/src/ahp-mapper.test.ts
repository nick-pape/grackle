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
  it("maps to SessionTurnStarted with userMessage", () => {
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
      userMessage: { text: string };
    }>(result.actions, ActionType.SessionTurnStarted);
    expect(action.turnId).toBe("turn-abc");
    expect(action.userMessage.text).toBe("Hello world");
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

  it("drops when no matching tool call", () => {
    const context = makeContext({ turnId: "turn-abc", openToolCalls: [] });
    const event = makeEvent("tool_result", { content: "{}" });
    const result = mapAgentEvent(event, 5, context);

    expect(result.actions.length).toBe(0);
    expect(result.note?.disposition).toBe("dropped");
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
