/**
 * AHP `StateAction` → PowerLine `AgentEvent` reverse mapper (AHP HR8d / #1336).
 *
 * The inverse of {@link mapAgentEvent}. Consumes AHP action envelopes as they
 * arrive on the wire and synthesizes the `AgentEventFields` shape that
 * downstream Grackle consumers (`event-processor.ts`, JSONL writer,
 * lifecycle handlers) expect.
 *
 * Lives in `@grackle-ai/common` next to `ahp-mapper.ts` because both mappers
 * are pure functions over the AHP action vocabulary and the AgentEvent shape.
 * Used by `AhpHostTransport` (in `@grackle-ai/adapter-sdk`) on every
 * inbound `action` notification.
 *
 * Tool calls produce a coalesced single `tool_use` AgentEvent only after
 * BOTH `SessionToolCallStart` and `SessionToolCallReady` have arrived
 * (the forward mapper emits them as a pair). Other actions produce zero or
 * one event each.
 *
 * @module ahp-reverse-mapper
 */

import {
  ActionType,
  ResponsePartKind,
  type ActionEnvelope,
  type SessionCreationFailedAction,
  type SessionErrorAction,
  type SessionMetaChangedAction,
  type SessionResponsePartAction,
  type SessionToolCallCompleteAction,
  type SessionToolCallReadyAction,
  type SessionToolCallStartAction,
  type SessionTurnCompleteAction,
  type SessionTurnStartedAction,
} from "@grackle-ai/ahp";

import type { AgentEventFields } from "./ahp-mapper.js";

/**
 * Pending half of a tool call (waiting for the matching `SessionToolCallReady`
 * to complete the pair before emitting one `tool_use` event). Exported so
 * the public `ReverseMapperContext` type doesn't leak an unexported symbol.
 */
export interface PendingToolCall {
  readonly turnId: string;
  readonly toolName: string;
  readonly displayName: string;
}

/**
 * Per-session context maintained by `AhpHostTransport`. Tracks the half
 * of a tool-call pair that has arrived (and is awaiting its mate) plus the
 * meta accumulator that lets cost/runtime-session-id ride alongside the
 * action stream via `SessionMetaChangedAction`.
 */
export interface ReverseMapperContext {
  /** ID of the currently active turn, or `undefined` between turns. */
  turnId?: string;
  /** Pending `SessionToolCallStart` envelopes awaiting their `SessionToolCallReady`, keyed by toolCallId. */
  readonly pendingToolCalls: Map<string, PendingToolCall>;
  /** Accumulated meta carried from `SessionMetaChangedAction` envelopes. */
  readonly metaAccumulator: {
    costMillicents?: number;
    runtimeSessionId?: string;
  };
}

/**
 * Construct a fresh per-session reverse-mapper context.
 *
 * @returns A new {@link ReverseMapperContext} with empty state.
 */
export function newReverseMapperContext(): ReverseMapperContext {
  return {
    turnId: undefined,
    pendingToolCalls: new Map<string, PendingToolCall>(),
    metaAccumulator: {},
  };
}

/**
 * Result of reverse-mapping a single `ActionEnvelope`.
 *
 * Zero events: the action was buffered (e.g. `SessionToolCallStart` waiting
 * for its `Ready`) or has no AgentEvent representation (e.g. a root-channel
 * action arriving on a session subscription).
 *
 * One event: the typical case.
 *
 * Two events: errors emit both `error` and `status: failed` so the
 * lifecycle-handling code in `event-processor.ts` (which keys off
 * `status: failed` for end-reason) still fires.
 */
export interface ReverseMapResult {
  /** Synthesized AgentEventFields, in emission order. May be empty. */
  readonly events: AgentEventFields[];
  /** Brief disposition note (for diagnostics; never affects behavior). */
  readonly disposition: "mapped" | "carried" | "dropped" | "buffered";
  /** Detail string accompanying the disposition. */
  readonly detail: string;
}

/**
 * Strip the synthetic `turn-orphan-N` turnId that PowerLine's forwarder
 * attaches to events emitted outside an active turn (text/system/tool_*).
 * Returns `undefined` for synthetic turns so the resulting AgentEvent
 * matches the gRPC wire shape (which had no `turnId` for pre-turn events).
 * Returns the original turnId for real turns.
 */
function stripOrphanTurn(turnId: string): string | undefined {
  return turnId.startsWith("turn-orphan-") ? undefined : turnId;
}

/**
 * Reverse-map one AHP action envelope into 0..N PowerLine AgentEvents.
 *
 * @param envelope - The inbound `ActionEnvelope` carrying the AHP action.
 * @param context - Per-session context (mutated to track turn state and
 *   pending tool-call pairs).
 * @returns A {@link ReverseMapResult} with the synthesized events.
 */
export function reverseMapAction(
  envelope: ActionEnvelope,
  context: ReverseMapperContext,
): ReverseMapResult {
  const action = envelope.action;

  switch (action.type) {
    case ActionType.SessionTurnStarted: {
      const a = action as SessionTurnStartedAction;
      // PowerLine's orphan rescue emits a SessionTurnStarted with a
      // `turn-orphan-N` synthetic turnId to wrap pre-turn content events.
      // Hide those synthetic starts from the consumer — they don't
      // correspond to real user turns and would pollute the event stream.
      if (a.turnId.startsWith("turn-orphan-")) {
        return {
          events: [],
          disposition: "carried",
          detail: `synthetic orphan turn_started (turnId=${a.turnId}) suppressed`,
        };
      }
      context.turnId = a.turnId;
      const userText = a.userMessage.text;
      return {
        events: [
          {
            type: "turn_started",
            turnId: a.turnId,
            content: JSON.stringify({ user_message: userText }),
          },
        ],
        disposition: "mapped",
        detail: `turn_started (turnId=${a.turnId})`,
      };
    }

    case ActionType.SessionTurnComplete: {
      const a = action as SessionTurnCompleteAction;
      // Suppress synthetic orphan turn_complete events (paired with the
      // suppressed turn_started above).
      if (a.turnId.startsWith("turn-orphan-")) {
        return {
          events: [],
          disposition: "carried",
          detail: `synthetic orphan turn_complete (turnId=${a.turnId}) suppressed`,
        };
      }
      context.turnId = undefined;
      return {
        events: [
          {
            type: "turn_complete",
            turnId: a.turnId,
          },
        ],
        disposition: "mapped",
        detail: `turn_complete (turnId=${a.turnId})`,
      };
    }

    case ActionType.SessionResponsePart: {
      const a = action as SessionResponsePartAction;
      // PowerLine wraps orphan events (text/system/tool_* emitted outside a
      // turn under gRPC) in a synthetic `turn-orphan-N` turn so AHP's
      // action stream can carry them. On the consumer side, strip the
      // synthetic turnId so the resulting AgentEvent matches the gRPC
      // wire shape (which had no turnId for pre-turn events).
      // Only Markdown and SystemNotification parts have AgentEvent representations;
      // ContentRef/ToolCall/Reasoning parts don't map to AgentEvent (drop).
      if (a.part.kind === ResponsePartKind.Markdown) {
        const evt: AgentEventFields = { type: "text", content: a.part.content };
        const tid = stripOrphanTurn(a.turnId);
        if (tid !== undefined) {
          evt.turnId = tid;
        }
        return {
          events: [evt],
          disposition: "mapped",
          detail: "text part",
        };
      }
      if (a.part.kind === ResponsePartKind.SystemNotification) {
        const partContent = a.part.content;
        // SystemNotification.content is StringOrMarkdown (string | { markdown: string }).
        const contentStr = typeof partContent === "string" ? partContent : partContent.markdown;
        const evt: AgentEventFields = { type: "system", content: contentStr };
        const tid = stripOrphanTurn(a.turnId);
        if (tid !== undefined) {
          evt.turnId = tid;
        }
        return {
          events: [evt],
          disposition: "mapped",
          detail: "system notification part",
        };
      }
      return {
        events: [],
        disposition: "dropped",
        detail: `unmapped ResponsePart kind: ${String(a.part.kind)}`,
      };
    }

    case ActionType.SessionToolCallStart: {
      const a = action as SessionToolCallStartAction;
      // Buffer until SessionToolCallReady arrives with the same toolCallId.
      context.pendingToolCalls.set(a.toolCallId, {
        turnId: a.turnId,
        toolName: a.toolName,
        displayName: a.displayName,
      });
      return {
        events: [],
        disposition: "buffered",
        detail: `tool_use start buffered (toolCallId=${a.toolCallId})`,
      };
    }

    case ActionType.SessionToolCallReady: {
      const a = action as SessionToolCallReadyAction;
      // Rehydrate the args payload from the AHP-spec `toolInput` field so the
      // UI's tool-card preview ("filename" line, expanded JSON view) has the
      // arguments to render. Producer side stringifies them; we parse back to
      // the original shape if possible, else carry as a string.
      let args: unknown;
      if (a.toolInput !== undefined && a.toolInput !== "") {
        try {
          args = JSON.parse(a.toolInput) as unknown;
        } catch {
          args = a.toolInput;
        }
      }
      const pending = context.pendingToolCalls.get(a.toolCallId);
      if (pending === undefined) {
        // Orphan Ready (Start was missed). Emit a degraded tool_use using
        // only Ready's data — better than dropping.
        const orphanEvt: AgentEventFields = {
          type: "tool_use",
          toolCallId: a.toolCallId,
          content: JSON.stringify({
            tool: "unknown_tool",
            tool_name: "unknown_tool",
            display_name: "unknown_tool",
            invocation_message: a.invocationMessage,
            ...(args !== undefined ? { args } : {}),
          }),
        };
        // Strip the synthetic orphan turnId — symmetric with text/system
        // response parts above. Without this, orphan tool_use events leak
        // the turn-orphan-N id and break the "match the gRPC wire shape"
        // contract for downstream consumers (turn-keyed UI grouping, JSONL).
        const orphanTid = stripOrphanTurn(a.turnId);
        if (orphanTid !== undefined) {
          orphanEvt.turnId = orphanTid;
        }
        return {
          events: [orphanEvt],
          disposition: "mapped",
          detail: `tool_use (orphan Ready, toolCallId=${a.toolCallId})`,
        };
      }
      context.pendingToolCalls.delete(a.toolCallId);
      const evt: AgentEventFields = {
        type: "tool_use",
        toolCallId: a.toolCallId,
        // Emit both `tool` and `tool_name` so downstream code reading either
        // key works (web's pairToolEvents reads `tool`; older paths read
        // `tool_name`).
        content: JSON.stringify({
          tool: pending.toolName,
          tool_name: pending.toolName,
          display_name: pending.displayName,
          invocation_message: a.invocationMessage,
          ...(args !== undefined ? { args } : {}),
        }),
      };
      const tid = stripOrphanTurn(pending.turnId);
      if (tid !== undefined) {
        evt.turnId = tid;
      }
      return {
        events: [evt],
        disposition: "mapped",
        detail: `tool_use coalesced (toolCallId=${a.toolCallId})`,
      };
    }

    case ActionType.SessionToolCallComplete: {
      const a = action as SessionToolCallCompleteAction;
      const isOk = a.result.success;
      // Extract result text from the first text content item, if any.
      let resultText = "";
      if (Array.isArray(a.result.content)) {
        const firstText = a.result.content.find((c) => "text" in c && typeof c.text === "string");
        if (firstText !== undefined && "text" in firstText) {
          resultText = String(firstText.text);
        }
      }
      const pastTenseMessage = a.result.pastTenseMessage;
      const trEvt: AgentEventFields = {
        type: "tool_result",
        toolCallId: a.toolCallId,
        content: JSON.stringify({
          is_ok: isOk,
          content: resultText,
          past_tense_message: pastTenseMessage,
        }),
      };
      const trTid = stripOrphanTurn(a.turnId);
      if (trTid !== undefined) {
        trEvt.turnId = trTid;
      }
      return {
        events: [trEvt],
        disposition: "mapped",
        detail: `tool_result (toolCallId=${a.toolCallId}, ok=${String(isOk)})`,
      };
    }

    case ActionType.SessionError: {
      const a = action as SessionErrorAction;
      context.turnId = undefined;
      // Emit error + status:failed so event-processor's lifecycle hook fires.
      return {
        events: [
          {
            type: "error",
            turnId: a.turnId,
            content: a.error.message,
          },
          {
            type: "status",
            content: "failed",
          },
        ],
        disposition: "mapped",
        detail: `error + status:failed (turnId=${a.turnId})`,
      };
    }

    case ActionType.SessionCreationFailed: {
      const a = action as SessionCreationFailedAction;
      return {
        events: [
          {
            type: "error",
            content: a.error.message,
          },
          {
            type: "status",
            content: "failed",
          },
        ],
        disposition: "mapped",
        detail: "session creation failed",
      };
    }

    case ActionType.SessionMetaChanged: {
      const a = action as SessionMetaChangedAction;
      const events: AgentEventFields[] = [];
      const meta = a._meta;
      if (meta !== undefined) {
        const runtimeSessionIdRaw = meta.runtime_session_id;
        if (
          typeof runtimeSessionIdRaw === "string" &&
          runtimeSessionIdRaw !== context.metaAccumulator.runtimeSessionId
        ) {
          context.metaAccumulator.runtimeSessionId = runtimeSessionIdRaw;
          events.push({ type: "runtime_session_id", content: runtimeSessionIdRaw });
        }
        const costRaw = meta.cost_millicents;
        if (typeof costRaw === "number") {
          const prevCost = context.metaAccumulator.costMillicents ?? 0;
          const delta = costRaw - prevCost;
          context.metaAccumulator.costMillicents = costRaw;
          if (delta !== 0) {
            events.push({
              type: "usage",
              content: JSON.stringify({ cost_millicents: delta }),
            });
          }
        }
        // HR8d status rescue: PowerLine forwards lifecycle status events
        // (running / waiting_input / idle / completed) as `_meta.status`
        // because mapAgentEvent unconditionally drops them as "redundant
        // with turn_* events". Grackle's consumer uses these to flip
        // `sessions.status`; rehydrate them here.
        const statusRaw = meta.status;
        if (typeof statusRaw === "string") {
          events.push({ type: "status", content: statusRaw });
        }
      }
      return {
        events,
        disposition: events.length > 0 ? "mapped" : "carried",
        detail: `meta change (${events.length} synthesized events)`,
      };
    }

    default:
      // All other action types (root-channel notifications, terminal events,
      // changeset events, etc.) have no AgentEvent representation. Drop.
      return {
        events: [],
        disposition: "dropped",
        detail: `unmapped action type: ${String(action.type)}`,
      };
  }
}
