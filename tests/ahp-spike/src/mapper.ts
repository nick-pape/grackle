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
 * REFRESH (against `main` after HR1a/HR3/HR6/HR7 merged): several original hacks
 * have shrunk because the production model moved toward AHP:
 *   • HR3 (#1287) — first-class `AgentEvent.toolCallId`: the `raw`-digging
 *     heuristic and the fragile "last-open" tool-result pairing are gone.
 *   • HR7 (#1290) — `AgentEvent.diagnostic`: lifecycle/diagnostic `system`
 *     events are classified at the source and routed to the `ahp-otlp:`
 *     telemetry channel; they no longer "drop with no home."
 *   • HR7 Part 1 (#1305) — `finding`/`subtask_create`/`escalation` removed from
 *     `AgentEventType`: orchestration-off-the-session-channel is now enforced by
 *     the type system, so the stub-only carry handling is deleted.
 * Still synthesized (pending in-flight work): turn framing (HR2 #1286) and the
 * root/session-creation channel (HR4+5 #1318). Re-run this exercise once those
 * merge to retire the remaining synthesis. See FINDINGS.md.
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

/** A status `content` string that ends the current turn. */
const TURN_ENDING_STATUSES: ReadonlySet<string> = new Set([
  "waiting_input",
  "completed",
  "terminated",
  "killed",
]);

// ─── Mapper ──────────────────────────────────────────────────────────────────

/**
 * Translate a Grackle `AgentEvent[]` into AHP session actions plus a per-event
 * accounting of how each was handled.
 *
 * Turn framing: AHP requires `session/turnStarted` before any
 * delta/responsePart/toolCall action (the reducer no-ops otherwise). Grackle has
 * no turn concept — only `status` running↔waiting_input. We open a turn lazily on
 * the first content-bearing event (or an explicit `running` status) and close it
 * on a turn-ending status. This framing rule is itself one of the findings.
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

  /** Ensure a turn is open, synthesizing `session/turnStarted` if needed. */
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
      case "text": {
        const turnId = ensureTurn("(synthesized: Grackle has no explicit user turn)");
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
        const turnId = ensureTurn("(synthesized)");
        const parsed = parseContent(event.content);
        const toolName = typeof parsed?.["tool"] === "string" ? (parsed["tool"] as string) : "tool";
        const args = parsed?.["args"];
        // HR3 (#1287): every runtime now populates a stable first-class
        // `AgentEvent.toolCallId`. The synthesized fallback survives only as
        // defensiveness for pre-HR3 logs that lack it.
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
        const turnId = ensureTurn("(synthesized)");
        // HR3 (#1287): pair on the first-class `AgentEvent.toolCallId`. The
        // original spike's fragile "last-open" heuristic (which broke under
        // concurrent/interleaved tool calls, notably for ACP) is now a defensive
        // fallback only — with toolCallId populated, that failure mode is gone.
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
        const turnId = ensureTurn("(synthesized)");
        const parsed = parseContent(event.content) ?? {};
        const usage: UsageInfo = {
          inputTokens: typeof parsed["input_tokens"] === "number" ? (parsed["input_tokens"] as number) : undefined,
          outputTokens: typeof parsed["output_tokens"] === "number" ? (parsed["output_tokens"] as number) : undefined,
          // AHP UsageInfo has no cost field → cost rides in _meta. SNAG.
          _meta: parsed["cost_millicents"] !== undefined ? { cost_millicents: parsed["cost_millicents"] } : undefined,
        };
        actions.push({ type: ActionType.SessionUsage, turnId, usage });
        note(index, event.type, "carried", "→ session/usage; cost_millicents has no AHP field → usage._meta (snag)");
        break;
      }

      case "status": {
        const s = event.content;
        if (s === "running") {
          ensureTurn("(synthesized: status=running)");
          note(index, event.type, "mapped", "status=running → ensure open turn");
        } else if (s === "failed") {
          if (currentTurnId !== undefined) {
            endTurn({
              type: ActionType.SessionError,
              turnId: currentTurnId,
              error: { errorType: "failed", message: "session failed" },
            });
            note(index, event.type, "mapped", "status=failed → session/error (turn end)");
          } else {
            // Pre-turn failure: there is no turn to error on, so report it as a
            // session creation failure (mirrors the pre-turn `error` event path).
            actions.push({
              type: ActionType.SessionCreationFailed,
              error: { errorType: "failed", message: "session failed" },
            });
            note(index, event.type, "mapped", "pre-turn status=failed → session/creationFailed");
          }
        } else if (TURN_ENDING_STATUSES.has(s)) {
          if (currentTurnId !== undefined) {
            endTurn({ type: ActionType.SessionTurnComplete, turnId: currentTurnId });
            note(index, event.type, "mapped", `status=${s} → session/turnComplete`);
          } else {
            note(index, event.type, "dropped", `status=${s} with no open turn → nothing to close`);
          }
        } else {
          note(index, event.type, "dropped", `status=${s} has no AHP analog`);
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
          // HR7 (#1290): runtime lifecycle/diagnostic system events ("Starting
          // runtime…", "Session initialized", worktree setup) are now classified
          // at the source via `AgentEvent.diagnostic`. Their home is the
          // `ahp-otlp:` telemetry channel (logs), NOT session state — exactly the
          // gap the original spike flagged ("pre-turn system → no home / dropped").
          // So this is a deliberate, clean carry to telemetry, not a loss.
          note(index, event.type, "carried", "diagnostic=true → ahp-otlp telemetry channel (HR7), out of SessionState by design");
        } else if (currentTurnId !== undefined) {
          // A non-diagnostic (substantive) system message inside a turn — keep it
          // in the conversation as a system notification.
          const part: ResponsePart = {
            kind: ResponsePartKind.SystemNotification,
            content: event.content,
          };
          actions.push({ type: ActionType.SessionResponsePart, turnId: currentTurnId, part });
          note(index, event.type, "mapped", "substantive system → session/responsePart(systemNotification)");
        } else {
          // Substantive system message before any turn opens — rare now that
          // lifecycle chatter is flagged diagnostic; nothing to attach it to.
          note(index, event.type, "dropped", "pre-turn non-diagnostic system message → no open turn to attach to");
        }
        break;
      }

      case "runtime_session_id": {
        meta["runtimeSessionId"] = event.content;
        flushMeta();
        note(index, event.type, "carried", "→ session/_meta.runtimeSessionId (no first-class field)");
        break;
      }

      // NOTE: there is deliberately no `finding` / `subtask_create` / `escalation`
      // case. HR7 Part 1 (#1305) REMOVED those members from `AgentEventType`
      // entirely, so the type system now ENFORCES what the original spike could
      // only assert in prose: orchestration (findings, subtasks, escalations)
      // never rides the agent-conversation channel — it is an MCP syscall, out of
      // band. The earlier "carried via _meta / fabricated subagent tool call"
      // handling was a stub-fixture artifact and is gone.

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
