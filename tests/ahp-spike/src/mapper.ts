/**
 * AgentEvent → AHP SessionAction mapper.
 *
 * This is the throwaway probe at the heart of the spike (#1232): a one-way
 * translation from Grackle's flat `AgentEvent` stream into the structured AHP
 * session **action** vocabulary. Folding the output through the vendored AHP
 * `sessionReducer` (see `mapper.test.ts`) reconstructs an AHP `SessionState`,
 * which tells us — by construction — where the two models line up and where
 * Grackle's session model is idiosyncratic.
 *
 * The mapper is deliberately NOT the production artifact. The end state for
 * #1232 is "PowerLine becomes an AHP host" (it owns AHP-native state directly);
 * this mapper merely surfaces the gaps that work will have to close.
 *
 * REFRESH (against `main` after all groundwork HRs merged):
 *   • HR3 (#1287) — first-class `AgentEvent.toolCallId`: `raw`-digging heuristic
 *     and fragile last-open tool-result pairing gone.
 *   • HR7 (#1290) — `AgentEvent.diagnostic`: lifecycle system events now route
 *     to the `ahp-otlp:` telemetry channel by design; "no AHP home" gap closed.
 *   • HR7 Part 1 (#1305) — `finding`/`subtask_create`/`escalation` removed from
 *     `AgentEventType`: orchestration-off-channel now type-enforced.
 *   • HR4+5 (#1318) — root channel (runtime registry / session-creation shape)
 *     now AHP-aligned in production. No mapper change (session-event mapper only).
 *   • HR2 (#1286) — first-class `turn_started`/`turn_complete`/`input_needed`
 *     events + `AgentEvent.turnId`: the lazy-turn synthesis and
 *     `TURN_ENDING_STATUSES` heuristic are gone.
 *
 * What's left: the two AHP-upstream metadata carries (`cost_millicents`,
 * `runtime_session_id`) + a defensive `ensureTurn` fallback for pre-HR2 logs.
 * See FINDINGS-REFRESH.md.
 */

import type { AgentEvent } from "@grackle-ai/runtime-sdk";
import type { AgentEventType } from "@grackle-ai/common";

import { ActionType } from "./vendor/ahp/common/actions.js";
import type { SessionAction } from "./vendor/ahp/action-origin.generated.js";
import {
  ResponsePartKind,
  ToolCallConfirmationReason,
  ToolResultContentType,
} from "./vendor/ahp/channels-session/state.js";
import type { ResponsePart, ToolCallResult } from "./vendor/ahp/channels-session/state.js";
import type { ErrorInfo, UsageInfo } from "./vendor/ahp/common/state.js";

// ─── Result shape ────────────────────────────────────────────────────────────

/** How a source `AgentEvent` was handled by the mapper. */
export type Disposition =
  /** Maps onto a native AHP session action with no semantic loss. */
  | "mapped"
  /** Has no native AHP action; carried via an extension point (`_meta`, systemNotification, ToolResultSubagentContent). */
  | "carried"
  /** No representation in AHP `SessionState` at all; dropped. */
  | "dropped";

/** A per-event record of how the mapper treated it (the experiment's findings). */
export interface MappingNote {
  /** Index of the source event in the input stream. */
  index: number;
  /** Source event discriminator. */
  type: AgentEventType;
  /** How it was handled. */
  disposition: Disposition;
  /** Human-readable explanation of the mapping decision / strain. */
  detail: string;
}

/** Output of {@link mapAgentEvents}. */
export interface MapResult {
  /** The AHP session actions, in order, ready to fold through `sessionReducer`. */
  actions: SessionAction[];
  /** Every per-event mapping decision. */
  notes: MappingNote[];
  /** Events carried via an AHP extension point rather than a native action. */
  carried: MappingNote[];
  /** Events with no AHP representation (dropped). */
  unmapped: MappingNote[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse an event's JSON `content`, returning `undefined` on failure. */
function parseContent(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

/**
 * Translate a Grackle `AgentEvent[]` into AHP session actions plus a per-event
 * accounting of how each was handled.
 *
 * Turn framing (HR2 #1286): `turn_started`/`turn_complete`/`input_needed` events
 * now carry real turn boundaries with the actual user message. The prior lazy-open
 * synthesis (ensureTurn + TURN_ENDING_STATUSES heuristic) is gone except as a
 * defensive fallback for pre-HR2 captured logs.
 */
export function mapAgentEvents(events: AgentEvent[]): MapResult {
  const actions: SessionAction[] = [];
  const notes: MappingNote[] = [];

  let turnCounter = 0;
  let partCounter = 0;
  let currentTurnId: string | undefined;
  /** Tool calls opened (Start+Ready) but not yet completed, most-recent last. */
  const openToolCalls: string[] = [];
  /** Accumulated session `_meta` (full-replacement action, so we merge ourselves). */
  const meta: Record<string, unknown> = {};

  const note = (index: number, type: AgentEventType, disposition: Disposition, detail: string): void => {
    notes.push({ index, type, disposition, detail });
  };

  /**
   * Defensive turn open — fires only on pre-HR2 streams or edge cases where
   * `turn_started` was not emitted. HR2 streams always open turns via `turn_started`.
   */
  const ensureTurn = (seedText: string): string => {
    if (currentTurnId === undefined) {
      currentTurnId = `turn-${++turnCounter}`;
      actions.push({
        type: ActionType.SessionTurnStarted,
        turnId: currentTurnId,
        userMessage: { text: seedText },
      });
    }
    return currentTurnId;
  };

  const endTurn = (action: SessionAction): void => {
    if (currentTurnId !== undefined) {
      actions.push(action);
      currentTurnId = undefined;
      openToolCalls.length = 0;
    }
  };

  /** Emit a full-replacement `session/metaChanged` with the merged accumulator. */
  const flushMeta = (): void => {
    actions.push({ type: ActionType.SessionMetaChanged, _meta: { ...meta } });
  };

  events.forEach((event, index) => {
    switch (event.type) {

      // ─── HR2: real turn boundaries ──────────────────────────────────────

      case "turn_started": {
        // HR2 (#1286): real turn open with the actual user message.
        // Replaces the lazy-open synthesis that fabricated a placeholder userMessage.
        currentTurnId = event.turnId ?? `turn-${++turnCounter}`;
        actions.push({
          type: ActionType.SessionTurnStarted,
          turnId: currentTurnId,
          userMessage: { text: event.content },
        });
        note(index, event.type, "mapped", "→ session/turnStarted (real userMessage, HR2)");
        break;
      }

      case "turn_complete": {
        // HR2 (#1286): real turn close — `status: waiting_input/completed`
        // → turnComplete synthesis is gone; this event is the authority.
        if (currentTurnId !== undefined) {
          endTurn({ type: ActionType.SessionTurnComplete, turnId: currentTurnId });
          note(index, event.type, "mapped", "→ session/turnComplete (HR2)");
        } else {
          note(index, event.type, "dropped", "turn_complete with no open turn (resume boundary or repeated close)");
        }
        break;
      }

      case "input_needed": {
        // HR2 (#1286): advisory that the session is waiting for user input.
        // AHP has a richer `InputNeeded` state (structured elicitation / input
        // requests), but Grackle has no mid-turn-blocking producer today — so
        // this is plumb-only. The turn is already closed by `turn_complete`.
        note(index, event.type, "dropped", "input_needed → advisory (no structured input requests); turn already closed by turn_complete");
        break;
      }

      // ─── Agent conversation content ─────────────────────────────────────

      case "text": {
        const turnId = ensureTurn("(defensive: pre-HR2 stream or missed turn_started)");
        const part: ResponsePart = {
          kind: ResponsePartKind.Markdown,
          id: `part-${++partCounter}`,
          content: event.content,
        };
        actions.push({ type: ActionType.SessionResponsePart, turnId, part });
        note(index, event.type, "mapped", "→ session/responsePart(markdown)");
        break;
      }

      case "tool_use": {
        const turnId = ensureTurn("(defensive: pre-HR2 stream or missed turn_started)");
        const parsed = parseContent(event.content);
        const toolName = typeof parsed?.["tool"] === "string" ? (parsed["tool"] as string) : "tool";
        const args = parsed?.["args"];
        // HR3 (#1287): every runtime populates a stable first-class `AgentEvent.toolCallId`.
        const toolCallId = event.toolCallId ?? `tc-${turnId}-${openToolCalls.length + 1}`;
        openToolCalls.push(toolCallId);
        actions.push({
          type: ActionType.SessionToolCallStart,
          turnId,
          toolCallId,
          toolName,
          displayName: toolName,
        });
        // Grackle auto-approves tool execution, so AHP confirmation is NotNeeded:
        // the call goes straight to `running`. Surfacing real HITL confirmation is
        // an opportunity AHP unlocks but Grackle does not currently use.
        actions.push({
          type: ActionType.SessionToolCallReady,
          turnId,
          toolCallId,
          invocationMessage: `Run ${toolName}`,
          toolInput: args === undefined ? undefined : JSON.stringify(args),
          confirmed: ToolCallConfirmationReason.NotNeeded,
        });
        note(index, event.type, "mapped", "→ session/toolCallStart + toolCallReady(NotNeeded→running)");
        break;
      }

      case "tool_result": {
        const turnId = ensureTurn("(defensive: pre-HR2 stream or missed turn_started)");
        // HR3 (#1287): pair on the first-class `AgentEvent.toolCallId`.
        const explicitId = event.toolCallId || undefined;
        const toolCallId = explicitId ?? openToolCalls[openToolCalls.length - 1];
        if (toolCallId === undefined) {
          note(index, event.type, "dropped", "tool_result with no matching open tool call (pairing failed)");
          break;
        }
        const pairedById = explicitId !== undefined;
        const idx = openToolCalls.indexOf(toolCallId);
        if (idx >= 0) {
          openToolCalls.splice(idx, 1);
        }
        const rawObj = (typeof event.raw === "object" && event.raw !== null ? event.raw : {}) as Record<string, unknown>;
        const isError = rawObj["is_error"] === true || rawObj["status"] === "failed";
        const result: ToolCallResult = {
          success: !isError,
          pastTenseMessage: isError ? "Tool failed" : "Tool completed",
          content: [{ type: ToolResultContentType.Text, text: event.content }],
        };
        actions.push({ type: ActionType.SessionToolCallComplete, turnId, toolCallId, result });
        note(
          index,
          event.type,
          "mapped",
          `→ session/toolCallComplete (paired ${pairedById ? "by toolCallId (HR3)" : "by last-open fallback"})`,
        );
        break;
      }

      case "usage": {
        const turnId = ensureTurn("(defensive: pre-HR2 stream or missed turn_started)");
        const parsed = parseContent(event.content) ?? {};
        const usage: UsageInfo = {
          inputTokens: typeof parsed["input_tokens"] === "number" ? (parsed["input_tokens"] as number) : undefined,
          outputTokens: typeof parsed["output_tokens"] === "number" ? (parsed["output_tokens"] as number) : undefined,
          // AHP UsageInfo has no cost field → cost rides in _meta. Residual AHP gap.
          _meta: parsed["cost_millicents"] !== undefined ? { cost_millicents: parsed["cost_millicents"] } : undefined,
        };
        actions.push({ type: ActionType.SessionUsage, turnId, usage });
        note(index, event.type, "carried", "→ session/usage; cost_millicents has no AHP field → usage._meta (AHP upstream gap)");
        break;
      }

      // ─── Session lifecycle ───────────────────────────────────────────────

      case "status": {
        const s = event.content;
        if (s === "failed") {
          if (currentTurnId !== undefined) {
            endTurn({
              type: ActionType.SessionError,
              turnId: currentTurnId,
              error: { errorType: "failed", message: "session failed" },
            });
            note(index, event.type, "mapped", "status=failed → session/error (turn end)");
          } else {
            actions.push({
              type: ActionType.SessionCreationFailed,
              error: { errorType: "failed", message: "session failed" },
            });
            note(index, event.type, "mapped", "pre-turn status=failed → session/creationFailed");
          }
        } else if (s === "killed" || s === "terminated") {
          // If a turn is still open, it was abandoned mid-flight (no turn_complete
          // preceded this kill/terminate). End it as an error.
          if (currentTurnId !== undefined) {
            endTurn({
              type: ActionType.SessionError,
              turnId: currentTurnId,
              error: { errorType: s, message: `session ${s}` },
            });
            note(index, event.type, "mapped", `status=${s} mid-turn → session/error (turn abandoned)`);
          } else {
            // Turn already closed cleanly by turn_complete — this is just the
            // Grackle session reaching a terminal Grackle state; no AHP action.
            note(index, event.type, "dropped", `status=${s} after clean turn_complete → no AHP session action needed`);
          }
        } else {
          // status=running, waiting_input, completed, and any future values:
          // turn lifecycle is now owned by turn_started/turn_complete events (HR2);
          // these status signals are redundant from the AHP mapper's perspective.
          note(index, event.type, "dropped", `status=${s} → redundant with HR2 turn_* events`);
        }
        break;
      }

      case "error": {
        if (currentTurnId !== undefined) {
          const turnId = currentTurnId;
          endTurn({
            type: ActionType.SessionError,
            turnId,
            error: { errorType: "error", message: event.content } satisfies ErrorInfo,
          });
          note(index, event.type, "mapped", "→ session/error (turn end)");
        } else {
          actions.push({
            type: ActionType.SessionCreationFailed,
            error: { errorType: "error", message: event.content } satisfies ErrorInfo,
          });
          note(index, event.type, "mapped", "pre-turn → session/creationFailed");
        }
        break;
      }

      case "system": {
        if (event.diagnostic) {
          // HR7 (#1290): lifecycle/diagnostic system events route to the
          // `ahp-otlp:` telemetry channel, NOT session state — by design.
          note(index, event.type, "carried", "diagnostic=true → ahp-otlp telemetry channel (HR7), out of SessionState by design");
        } else if (currentTurnId !== undefined) {
          const part: ResponsePart = {
            kind: ResponsePartKind.SystemNotification,
            content: event.content,
          };
          actions.push({ type: ActionType.SessionResponsePart, turnId: currentTurnId, part });
          note(index, event.type, "mapped", "substantive system → session/responsePart(systemNotification)");
        } else {
          note(index, event.type, "dropped", "pre-turn non-diagnostic system message → no open turn to attach to");
        }
        break;
      }

      case "runtime_session_id": {
        meta["runtimeSessionId"] = event.content;
        flushMeta();
        note(index, event.type, "carried", "→ session/_meta.runtimeSessionId (no first-class AHP field)");
        break;
      }

      // NOTE: there is deliberately no `finding` / `subtask_create` / `escalation`
      // case. HR7 Part 1 (#1305) REMOVED those members from `AgentEventType`
      // entirely, so the type system now ENFORCES what the original spike could
      // only assert in prose: orchestration never rides the conversation channel.

      default: {
        // Exhaustiveness guard — a new AgentEventType should surface here.
        const exhaustive: never = event.type;
        note(index, exhaustive, "dropped", "unhandled AgentEvent type");
        break;
      }
    }
  });

  return {
    actions,
    notes,
    carried: notes.filter((n) => n.disposition === "carried"),
    unmapped: notes.filter((n) => n.disposition === "dropped"),
  };
}
