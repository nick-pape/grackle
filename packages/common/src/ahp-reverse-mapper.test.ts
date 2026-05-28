/**
 * Reverse-mapper unit tests. Covers every AHP action type the mapper handles
 * plus dropped/buffered paths and round-trip-through-forward-mapper sanity.
 */

import {
  ActionType,
  ResponsePartKind,
  ToolCallConfirmationReason,
  ToolResultContentType,
  type ActionEnvelope,
  type ErrorInfo,
  type StateAction,
  type ToolResultContent,
} from "@grackle-ai/ahp";
import { describe, expect, it } from "vitest";

import { type AgentEventFields, mapAgentEvent, type MapperContext } from "./ahp-mapper.js";
import {
  newReverseMapperContext,
  reverseMapAction,
  type ReverseMapperContext,
} from "./ahp-reverse-mapper.js";

function envelope(action: StateAction, channel: string = "ahp-session:/x"): ActionEnvelope {
  return {
    channel,
    action,
    serverSeq: 1,
    origin: undefined,
  };
}

function errInfo(message: string): ErrorInfo {
  return { message, errorType: "unknown" } as ErrorInfo;
}

function textContent(text: string): ToolResultContent {
  return { type: ToolResultContentType.Text, text } as ToolResultContent;
}

describe("reverseMapAction", () => {
  describe("turn lifecycle", () => {
    it("SessionTurnStarted → turn_started with user_message JSON content", () => {
      const ctx = newReverseMapperContext();
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionTurnStarted,
          turnId: "turn-1",
          userMessage: { text: "hello" },
        }),
        ctx,
      );
      expect(res.events).toHaveLength(1);
      expect(res.events[0]?.type).toBe("turn_started");
      expect(res.events[0]?.turnId).toBe("turn-1");
      const parsed = JSON.parse(res.events[0]?.content ?? "") as { user_message: string };
      expect(parsed.user_message).toBe("hello");
      expect(ctx.turnId).toBe("turn-1");
    });

    it("SessionTurnComplete → turn_complete; clears context.turnId", () => {
      const ctx = newReverseMapperContext();
      ctx.turnId = "turn-1";
      const res = reverseMapAction(
        envelope({ type: ActionType.SessionTurnComplete, turnId: "turn-1" }),
        ctx,
      );
      expect(res.events).toEqual([{ type: "turn_complete", turnId: "turn-1" }]);
      expect(ctx.turnId).toBeUndefined();
    });
  });

  describe("response parts", () => {
    it("Markdown → text", () => {
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionResponsePart,
          turnId: "turn-1",
          part: { kind: ResponsePartKind.Markdown, id: "part-0", content: "hi there" },
        }),
        newReverseMapperContext(),
      );
      expect(res.events).toEqual([{ type: "text", turnId: "turn-1", content: "hi there" }]);
    });

    it("SystemNotification → system", () => {
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionResponsePart,
          turnId: "turn-1",
          part: { kind: ResponsePartKind.SystemNotification, content: "fyi" },
        }),
        newReverseMapperContext(),
      );
      expect(res.events).toEqual([{ type: "system", turnId: "turn-1", content: "fyi" }]);
    });
  });

  describe("tool calls (coalesced Start + Ready pair)", () => {
    it("Start buffers; Ready emits a single coalesced tool_use", () => {
      const ctx = newReverseMapperContext();
      const startRes = reverseMapAction(
        envelope({
          type: ActionType.SessionToolCallStart,
          turnId: "turn-1",
          toolCallId: "tc-1",
          toolName: "read_file",
          displayName: "Read",
        }),
        ctx,
      );
      expect(startRes.events).toEqual([]);
      expect(startRes.disposition).toBe("buffered");
      expect(ctx.pendingToolCalls.has("tc-1")).toBe(true);

      const readyRes = reverseMapAction(
        envelope({
          type: ActionType.SessionToolCallReady,
          turnId: "turn-1",
          toolCallId: "tc-1",
          invocationMessage: "Reading foo.txt",
          confirmed: ToolCallConfirmationReason.NotNeeded,
        }),
        ctx,
      );
      expect(readyRes.events).toHaveLength(1);
      const evt = readyRes.events[0]!;
      expect(evt.type).toBe("tool_use");
      expect(evt.turnId).toBe("turn-1");
      expect(evt.toolCallId).toBe("tc-1");
      const parsed = JSON.parse(evt.content ?? "") as {
        tool_name: string;
        display_name: string;
        invocation_message: string;
      };
      expect(parsed.tool_name).toBe("read_file");
      expect(parsed.display_name).toBe("Read");
      expect(parsed.invocation_message).toBe("Reading foo.txt");
      expect(ctx.pendingToolCalls.has("tc-1")).toBe(false);
    });

    it("Ready without matching Start emits degraded tool_use with unknown_tool", () => {
      const ctx = newReverseMapperContext();
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionToolCallReady,
          turnId: "turn-1",
          toolCallId: "tc-orphan",
          invocationMessage: "Running mystery",
          confirmed: ToolCallConfirmationReason.NotNeeded,
        }),
        ctx,
      );
      expect(res.events).toHaveLength(1);
      const parsed = JSON.parse(res.events[0]?.content ?? "") as { tool_name: string };
      expect(parsed.tool_name).toBe("unknown_tool");
    });

    it("Ready rehydrates `args` from toolInput onto the coalesced tool_use (HR8d)", () => {
      const ctx = newReverseMapperContext();
      reverseMapAction(
        envelope({
          type: ActionType.SessionToolCallStart,
          turnId: "turn-1",
          toolCallId: "tc-1",
          toolName: "echo",
          displayName: "echo",
        }),
        ctx,
      );
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionToolCallReady,
          turnId: "turn-1",
          toolCallId: "tc-1",
          invocationMessage: "Running echo",
          confirmed: ToolCallConfirmationReason.NotNeeded,
          toolInput: JSON.stringify({ message: "hello world" }),
        }),
        ctx,
      );
      const parsed = JSON.parse(res.events[0]?.content ?? "") as {
        tool: string;
        tool_name: string;
        args: { message: string };
      };
      // Both `tool` (legacy / web pairToolEvents) and `tool_name` (mapper docs)
      // are emitted so consumers reading either key work.
      expect(parsed.tool).toBe("echo");
      expect(parsed.tool_name).toBe("echo");
      expect(parsed.args).toEqual({ message: "hello world" });
    });

    it("Ready with unparseable toolInput carries it as a string fallback (HR8d)", () => {
      const ctx = newReverseMapperContext();
      reverseMapAction(
        envelope({
          type: ActionType.SessionToolCallStart,
          turnId: "turn-1",
          toolCallId: "tc-2",
          toolName: "raw",
          displayName: "raw",
        }),
        ctx,
      );
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionToolCallReady,
          turnId: "turn-1",
          toolCallId: "tc-2",
          invocationMessage: "Running raw",
          confirmed: ToolCallConfirmationReason.NotNeeded,
          toolInput: "not-json",
        }),
        ctx,
      );
      const parsed = JSON.parse(res.events[0]?.content ?? "") as { args: unknown };
      expect(parsed.args).toBe("not-json");
    });

    it("Orphan Ready also rehydrates args from toolInput (HR8d)", () => {
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionToolCallReady,
          turnId: "turn-1",
          toolCallId: "tc-orphan",
          invocationMessage: "Running mystery",
          confirmed: ToolCallConfirmationReason.NotNeeded,
          toolInput: JSON.stringify({ x: 1 }),
        }),
        newReverseMapperContext(),
      );
      const parsed = JSON.parse(res.events[0]?.content ?? "") as { args: { x: number } };
      expect(parsed.args).toEqual({ x: 1 });
    });

    it("SessionToolCallComplete (success) → tool_result with is_ok=true", () => {
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionToolCallComplete,
          turnId: "turn-1",
          toolCallId: "tc-1",
          result: {
            success: true,
            pastTenseMessage: "Read foo.txt",
            content: [textContent("file contents")],
            error: undefined,
          },
        }),
        newReverseMapperContext(),
      );
      expect(res.events).toHaveLength(1);
      const evt = res.events[0]!;
      expect(evt.type).toBe("tool_result");
      expect(evt.toolCallId).toBe("tc-1");
      const parsed = JSON.parse(evt.content ?? "") as {
        is_ok: boolean;
        content: string;
        past_tense_message: string;
      };
      expect(parsed.is_ok).toBe(true);
      expect(parsed.content).toBe("file contents");
      expect(parsed.past_tense_message).toBe("Read foo.txt");
    });

    it("SessionToolCallComplete (failure) → tool_result with is_ok=false", () => {
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionToolCallComplete,
          turnId: "turn-1",
          toolCallId: "tc-1",
          result: {
            success: false,
            pastTenseMessage: "Tried to read foo.txt",
            content: undefined,
            error: { message: "ENOENT" },
          },
        }),
        newReverseMapperContext(),
      );
      const parsed = JSON.parse(res.events[0]?.content ?? "") as { is_ok: boolean };
      expect(parsed.is_ok).toBe(false);
    });
  });

  describe("errors", () => {
    it("SessionError → error + status:failed; clears turnId", () => {
      const ctx = newReverseMapperContext();
      ctx.turnId = "turn-1";
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionError,
          turnId: "turn-1",
          error: errInfo("oh no"),
        }),
        ctx,
      );
      expect(res.events).toHaveLength(2);
      expect(res.events[0]).toEqual({ type: "error", turnId: "turn-1", content: "oh no" });
      expect(res.events[1]).toEqual({ type: "status", content: "failed" });
      expect(ctx.turnId).toBeUndefined();
    });

    it("SessionCreationFailed → error + status:failed (no turnId)", () => {
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionCreationFailed,
          error: errInfo("boot failure"),
        }),
        newReverseMapperContext(),
      );
      expect(res.events[0]).toEqual({ type: "error", content: "boot failure" });
      expect(res.events[1]).toEqual({ type: "status", content: "failed" });
    });
  });

  describe("meta (cost / runtime_session_id)", () => {
    it("SessionMetaChanged with runtime_session_id → emits runtime_session_id event once", () => {
      const ctx = newReverseMapperContext();
      const res1 = reverseMapAction(
        envelope({
          type: ActionType.SessionMetaChanged,
          _meta: { runtime_session_id: "rt-abc" },
        }),
        ctx,
      );
      expect(res1.events).toEqual([{ type: "runtime_session_id", content: "rt-abc" }]);
      expect(ctx.metaAccumulator.runtimeSessionId).toBe("rt-abc");

      // Repeat with same id → no new event.
      const res2 = reverseMapAction(
        envelope({
          type: ActionType.SessionMetaChanged,
          _meta: { runtime_session_id: "rt-abc" },
        }),
        ctx,
      );
      expect(res2.events).toEqual([]);
      expect(res2.disposition).toBe("carried");
    });

    it("SessionMetaChanged with cost_millicents → emits delta-based usage events", () => {
      const ctx = newReverseMapperContext();
      const res1 = reverseMapAction(
        envelope({
          type: ActionType.SessionMetaChanged,
          _meta: { cost_millicents: 100 },
        }),
        ctx,
      );
      expect(res1.events).toHaveLength(1);
      const parsed1 = JSON.parse(res1.events[0]?.content ?? "") as { cost_millicents: number };
      expect(parsed1.cost_millicents).toBe(100);
      expect(ctx.metaAccumulator.costMillicents).toBe(100);

      const res2 = reverseMapAction(
        envelope({
          type: ActionType.SessionMetaChanged,
          _meta: { cost_millicents: 250 },
        }),
        ctx,
      );
      const parsed2 = JSON.parse(res2.events[0]?.content ?? "") as { cost_millicents: number };
      expect(parsed2.cost_millicents).toBe(150); // delta
    });

    it("SessionMetaChanged with no recognized keys → carried with no events", () => {
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionMetaChanged,
          _meta: { something_else: 42 },
        }),
        newReverseMapperContext(),
      );
      expect(res.events).toEqual([]);
      expect(res.disposition).toBe("carried");
    });

    it("SessionMetaChanged with undefined _meta → carried with no events", () => {
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionMetaChanged,
          _meta: undefined,
        }),
        newReverseMapperContext(),
      );
      expect(res.events).toEqual([]);
    });
  });

  describe("dropped action types", () => {
    it("unmapped action type drops with disposition='dropped'", () => {
      const res = reverseMapAction(
        envelope({
          type: ActionType.SessionDelta,
          turnId: "turn-1",
          messageId: "m-1",
          deltaContent: "...",
        } as never),
        newReverseMapperContext(),
      );
      expect(res.events).toEqual([]);
      expect(res.disposition).toBe("dropped");
    });
  });

  describe("forward+reverse round-trip", () => {
    function freshMapperContext(): MapperContext {
      return {
        turnId: undefined,
        openToolCalls: [],
        partCounter: 0,
        eventIndex: 0,
        metaAccumulator: {},
      };
    }

    function pushRoundTrip(
      event: AgentEventFields,
      forwardCtx: MapperContext,
      reverseCtx: ReverseMapperContext,
    ): AgentEventFields[] {
      const forwardResult = mapAgentEvent(event, forwardCtx.eventIndex++, forwardCtx);
      const events: AgentEventFields[] = [];
      for (const action of forwardResult.actions) {
        const rev = reverseMapAction(envelope(action), reverseCtx);
        events.push(...rev.events);
      }
      return events;
    }

    it("turn_started round-trips type + turnId + user_message", () => {
      const out = pushRoundTrip(
        {
          type: "turn_started",
          content: JSON.stringify({ user_message: "hi" }),
          turnId: "turn-1",
        },
        freshMapperContext(),
        newReverseMapperContext(),
      );
      expect(out).toHaveLength(1);
      expect(out[0]?.type).toBe("turn_started");
      expect(out[0]?.turnId).toBe("turn-1");
      const parsed = JSON.parse(out[0]?.content ?? "") as { user_message: string };
      expect(parsed.user_message).toBe("hi");
    });

    it("text inside a turn round-trips", () => {
      const fctx = freshMapperContext();
      const rctx = newReverseMapperContext();
      pushRoundTrip(
        { type: "turn_started", content: JSON.stringify({ user_message: "?" }), turnId: "turn-1" },
        fctx,
        rctx,
      );
      const out = pushRoundTrip({ type: "text", content: "answer", turnId: "turn-1" }, fctx, rctx);
      expect(out).toEqual([{ type: "text", turnId: "turn-1", content: "answer" }]);
    });

    it("tool_use → Start+Ready → coalesced tool_use round-trips", () => {
      const fctx = freshMapperContext();
      const rctx = newReverseMapperContext();
      pushRoundTrip(
        { type: "turn_started", content: JSON.stringify({ user_message: "?" }), turnId: "turn-1" },
        fctx,
        rctx,
      );
      const out = pushRoundTrip(
        {
          type: "tool_use",
          turnId: "turn-1",
          toolCallId: "tc-1",
          content: JSON.stringify({
            tool_name: "ls",
            display_name: "List",
            invocation_message: "Listing files",
          }),
        },
        fctx,
        rctx,
      );
      expect(out).toHaveLength(1);
      const evt = out[0]!;
      expect(evt.type).toBe("tool_use");
      expect(evt.toolCallId).toBe("tc-1");
      const parsed = JSON.parse(evt.content ?? "") as {
        tool_name: string;
        invocation_message: string;
      };
      expect(parsed.tool_name).toBe("ls");
      expect(parsed.invocation_message).toBe("Listing files");
    });

    it("tool_result success round-trips with is_ok=true", () => {
      const fctx = freshMapperContext();
      const rctx = newReverseMapperContext();
      pushRoundTrip(
        { type: "turn_started", content: JSON.stringify({ user_message: "?" }), turnId: "turn-1" },
        fctx,
        rctx,
      );
      pushRoundTrip(
        {
          type: "tool_use",
          turnId: "turn-1",
          toolCallId: "tc-1",
          content: JSON.stringify({
            tool_name: "ls",
            display_name: "List",
            invocation_message: "Listing",
          }),
        },
        fctx,
        rctx,
      );
      const out = pushRoundTrip(
        {
          type: "tool_result",
          turnId: "turn-1",
          toolCallId: "tc-1",
          content: JSON.stringify({ is_ok: true, content: "ok!", past_tense_message: "Listed" }),
        },
        fctx,
        rctx,
      );
      // Forward emits Complete + (optional) SystemNotification for success;
      // reverse emits tool_result + (optional) system.
      const toolResult = out.find((e) => e.type === "tool_result");
      expect(toolResult).toBeDefined();
      const parsed = JSON.parse(toolResult?.content ?? "") as { is_ok: boolean };
      expect(parsed.is_ok).toBe(true);
    });

    it("turn_complete round-trips", () => {
      const fctx = freshMapperContext();
      const rctx = newReverseMapperContext();
      pushRoundTrip(
        { type: "turn_started", content: JSON.stringify({ user_message: "?" }), turnId: "turn-1" },
        fctx,
        rctx,
      );
      const out = pushRoundTrip({ type: "turn_complete", turnId: "turn-1" }, fctx, rctx);
      expect(out).toEqual([{ type: "turn_complete", turnId: "turn-1" }]);
    });
  });
});
