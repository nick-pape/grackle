/**
 * AgentEvent → AHP SessionAction mapper (AHP HR1b / RFC #1292).
 *
 * Stateless function that translates a single PowerLine `AgentEvent` into one
 * or more AHP `SessionAction` payloads. The mapper is stateless — it requires
 * a `MapperContext` from the caller to track turn state and tool-call pairing.
 *
 * This mapper is an interim bridge while PowerLine still produces AgentEvents
 * and the AHP host eventually takes over the transport (HR8).
 *
 * @module ahp-mapper
 */

import type { powerline } from "@grackle-ai/common";
import {
  ActionType,
  ToolCallConfirmationReason,
  ToolResultContentType,
  ResponsePartKind,
  type ErrorInfo,
  type StateAction,
  type ToolResultContent,
} from "@grackle-ai/ahp";

/** Safely parse an event's content JSON, returning a record or undefined on failure. */
function safeParseContent(content?: string): Record<string, unknown> | undefined {
  if (!content) return undefined;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Disposition of a single AgentEvent after mapping.
 */
export type Disposition = "mapped" | "carried" | "dropped";

/**
 * Metadata describing how an AgentEvent was handled.
 */
export interface MappingNote {
  /** Index of the AgentEvent in the stream (0-based). */
  index: number;
  /** The original AgentEvent type string. */
  type: string;
  /** Whether the event was mapped to AHP actions, carried as metadata, or dropped. */
  disposition: Disposition;
  /** Human-readable detail about the mapping decision. */
  detail: string;
}

/**
 * Context maintained by `SessionStateManager` and passed to the mapper.
 * Tracks turn state and tool-call pairing across a stream of events.
 */
export interface MapperContext {
  /** ID of the currently active turn, or `undefined` if no turn has started. */
  turnId?: string;
  /**
   * Stack of open tool call IDs (LIFO). Used for pairing `tool_result` events
   * with their corresponding `tool_use` when `toolCallId` is not available.
   */
  openToolCalls: string[];
  /**
   * Monotonically increasing counter for generating unique part IDs within
   * the current session.
   */
  partCounter: number;
  /**
   * Accumulated `_meta` fields carried across events. The mapper merges
   * cost and runtimeSessionId into this object.
   */
  metaAccumulator: {
    /** Accumulated cost in millicents (AHP-upstream gap; rides on `_meta`). */
    costMillicents?: number;
    /** Runtime-provided session ID from the `runtime_session_id` event. */
    runtimeSessionId?: string;
  };
}

/** Result of mapping a single AgentEvent. */
export interface MapResult {
  /** AHP StateAction[] produced from this event (all session-specific). */
  actions: StateAction[];
  /** Notes describing the mapping disposition for each event. */
  notes: MappingNote[];
}

/** Build an ErrorInfo from a message string. */
function makeErrorInfo(message: string): ErrorInfo {
  return { message, errorType: "unknown" } as ErrorInfo;
}

/** Build a ToolResultContent from a string. */
function makeTextResult(text: string): ToolResultContent {
  return { type: ToolResultContentType.Text, text } as ToolResultContent;
}

/** Check whether a system event is a diagnostic (HR7) that routes to OTLP. */
function isDiagnosticEvent(event: powerline.AgentEvent): boolean {
  if (event.diagnostic) return true;
  const parsed = safeParseContent(event.content);
  if (parsed) {
    const keys = Object.keys(parsed);
    if (
      (keys.includes("span") || keys.includes("trace") || keys.includes("level")) &&
      !keys.some((k) => k === "text" || k === "content" || k === "tool_name")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Get a string field from parsed JSON content with fallbacks.
 * @param parsed - The parsed JSON object to look up.
 * @param fields - Field names to try (in order).
 * @param fallback - Literal fallback value if no field is found.
 * @returns The first found field value as a string, or the fallback.
 */
function str(
  parsed: Record<string, unknown>,
  fields: string[],
  fallback: string,
): string {
  for (const field of fields) {
    const val = parsed[field];
    if (val !== undefined) return String(val);
  }
  return fallback;
}

/**
 * Map a PowerLine `AgentEvent` into AHP `SessionAction` payloads.
 *
 * | AgentEvent type | AHP action(s) | Disposition |
 * |-----------------|---------------|-------------|
 * | `turn_started` | `SessionTurnStarted` | mapped |
 * | `turn_complete` | `SessionTurnComplete` | mapped |
 * | `input_needed` | advisory only | dropped |
 * | `text` | `SessionResponsePart(markdown)` | mapped |
 * | `tool_use` | `SessionToolCallStart` + `SessionToolCallReady` | mapped |
 * | `tool_result` | `SessionToolCallComplete` | mapped |
 * | `usage` | `SessionUsage` (+ cost via `_meta`) | carried |
 * | `error` (in-turn) | `SessionError` | mapped |
 * | `error` (pre-turn) | `SessionCreationFailed` | mapped |
 * | `status: failed` | `SessionError` or `SessionCreationFailed` | mapped |
 * | `status: killed/terminated` | `SessionError` (abandoned turn) | conditional |
 * | `status: completed/waiting_input/running` | dropped | dropped |
 * | `system` (diagnostic) | dropped (OTLP telemetry) | carried |
 * | `system` (non-diagnostic) | `SessionResponsePart(systemNotification)` | mapped |
 * | `runtime_session_id` | `_meta.runtimeSessionId` | carried |
 */
export function mapAgentEvent(
  event: powerline.AgentEvent,
  index: number,
  context: MapperContext,
): MapResult {
  const actions: StateAction[] = [];
  const notes: MappingNote[] = [];

  const { type, content, toolCallId, turnId } = event;
  // Proto string fields default to "", treat empty as undefined
  const eventTurnId = turnId || undefined;
  
  const parsed = safeParseContent(content);
  const hasParsed = parsed !== undefined;

  switch (type) {
    // ─── Turn lifecycle ────────────────────────────────────────────

    case "turn_started": {
      const userMessage = hasParsed
        ? str(parsed, ["user_message"], content || "")
        : content || "";
      // Always derive a fresh turnId when eventTurnId is absent — don't inherit stale context.turnId
      const derivedTurnId = eventTurnId || `turn-${index}`;

      actions.push({
        type: ActionType.SessionTurnStarted,
        turnId: derivedTurnId,
        userMessage: { text: userMessage },
      });

      context.turnId = derivedTurnId;
      context.openToolCalls = [];
      // partCounter starts at 0; first response part will be part-0
      context.partCounter = 0;

      notes.push({
        index,
        type: "turn_started",
        disposition: "mapped",
        detail: `Mapped to SessionTurnStarted (turnId=${context.turnId})`,
      });
      break;
    }

    case "turn_complete": {
      const turnId = eventTurnId || context.turnId;
      if (turnId) {
        actions.push({
          type: ActionType.SessionTurnComplete,
          turnId,
        });
        context.turnId = undefined;
        context.openToolCalls = [];

        notes.push({
          index,
          type: "turn_complete",
          disposition: "mapped",
          detail: `Mapped to SessionTurnComplete (turnId=${turnId})`,
        });
      } else {
        notes.push({
          index,
          type: "turn_complete",
          disposition: "dropped",
          detail: "No active turn to complete",
        });
      }
      break;
    }

    // ─── Dropped: advisory only ────────────────────────────────────

    case "input_needed": {
      notes.push({
        index,
        type: "input_needed",
        disposition: "dropped",
        detail: "Advisory event — no structured elicitation content yet",
      });
      break;
    }

    // ─── Response parts ────────────────────────────────────────────

    case "text": {
      const turnId = eventTurnId || context.turnId;
      if (!turnId) {
        notes.push({
          index,
          type: "text",
          disposition: "dropped",
          detail: "No active turn for text part",
        });
        break;
      }

      const partId = `part-${context.partCounter++}`;
      actions.push({
        type: ActionType.SessionResponsePart,
        turnId,
        part: {
          kind: ResponsePartKind.Markdown,
          id: partId,
          content: content || "",
        },
      });

      notes.push({
        index,
        type: "text",
        disposition: "mapped",
        detail: `Mapped to SessionResponsePart (partId=${partId})`,
      });
      break;
    }

    // ─── Tool calls ────────────────────────────────────────────────

    case "tool_use": {
      const turnId = eventTurnId || context.turnId;
      if (!turnId) {
        notes.push({
          index,
          type: "tool_use",
          disposition: "dropped",
          detail: "No active turn for tool_use",
        });
        break;
      }

      const toolCallIdValue = toolCallId || `tc-${context.partCounter++}`;
const toolName = hasParsed ? str(parsed, ["tool_name", "name"], "unknown_tool") : "unknown_tool";
       const displayName = hasParsed ? str(parsed, ["display_name"], toolName) : toolName;
       const invocationMessage = hasParsed
         ? str(parsed, ["invocation_message"], `Running ${toolName}`)
         : `Running ${toolName}`;

      // SessionToolCallStart
      actions.push({
        type: ActionType.SessionToolCallStart,
        turnId,
        toolCallId: toolCallIdValue,
        toolName,
        displayName,
      });

      // SessionToolCallReady with auto-confirmation
      actions.push({
        type: ActionType.SessionToolCallReady,
        turnId,
        toolCallId: toolCallIdValue,
        invocationMessage,
        confirmed: ToolCallConfirmationReason.NotNeeded,
      });

      context.openToolCalls.push(toolCallIdValue);

      notes.push({
        index,
        type: "tool_use",
        disposition: "mapped",
        detail: `Mapped to SessionToolCallStart + SessionToolCallReady (toolCallId=${toolCallIdValue})`,
      });
      break;
    }

    case "tool_result": {
      const turnId = eventTurnId || context.turnId;
      if (!turnId) {
        notes.push({
          index,
          type: "tool_result",
          disposition: "dropped",
          detail: "No active turn for tool_result",
        });
        break;
      }

      // Pair by first-class toolCallId (HR3), with LIFO stack fallback
      const pairedToolCallId = toolCallId || context.openToolCalls.pop() || "";

      // Remove matched id from stack when first-class toolCallId is provided
      if (toolCallId) {
        const idx = context.openToolCalls.indexOf(toolCallId);
        if (idx !== -1) {
          context.openToolCalls.splice(idx, 1);
        }
      }

      if (!pairedToolCallId) {
        notes.push({
          index,
          type: "tool_result",
          disposition: "dropped",
          detail: "No matching tool call for result",
        });
        break;
      }

      const isOk = hasParsed
        ? ("is_ok" in parsed ? parsed.is_ok === true : ("success" in parsed ? parsed.success === true : true))
        : true;
      const pastTenseMessage = hasParsed
        ? str(parsed, ["past_tense_message"], content || "")
        : content || "";
      const resultText = hasParsed
        ? str(parsed, ["content"], content || "")
        : content || "";

      actions.push({
        type: ActionType.SessionToolCallComplete,
        turnId,
        toolCallId: pairedToolCallId,
        result: {
          success: isOk,
          pastTenseMessage,
          content: isOk ? [makeTextResult(resultText)] : undefined,
          error: isOk ? undefined : { message: pastTenseMessage },
        },
      });

      // System notification for successful result
      if (isOk && content) {
        const displayText =
          resultText.length > 200 ? resultText.slice(0, 200) + "..." : resultText;
        actions.push({
          type: ActionType.SessionResponsePart,
          turnId,
          part: {
            kind: ResponsePartKind.SystemNotification,
            content: displayText,
          },
        });
      }

      notes.push({
        index,
        type: "tool_result",
        disposition: "mapped",
        detail: `Mapped to SessionToolCallComplete (toolCallId=${pairedToolCallId})`,
      });
      break;
    }

    // ─── Usage (carried via _meta) ─────────────────────────────────

    case "usage": {
      const rawCost = hasParsed ? parsed.cost_millicents : undefined;
      if (rawCost && Number.isFinite(Number(rawCost))) {
        const prevCost = context.metaAccumulator.costMillicents ?? 0;
        const cost = Number(rawCost);
        context.metaAccumulator.costMillicents = Math.max(
          0,
          prevCost + Math.trunc(cost),
        );
      }

      notes.push({
        index,
        type: "usage",
        disposition: "carried",
        detail: `Usage tracked — costMillicents now ${context.metaAccumulator.costMillicents ?? 0}`,
      });
      break;
    }

    // ─── Errors ────────────────────────────────────────────────────

    case "error": {
      const turnId = eventTurnId || context.turnId;
      const errorDetail = content || "Unknown error";

      if (turnId) {
        actions.push({
          type: ActionType.SessionError,
          turnId,
          error: makeErrorInfo(errorDetail),
        });
        notes.push({
          index,
          type: "error",
          disposition: "mapped",
          detail: `Mapped to SessionError (turnId=${turnId})`,
        });
      } else {
        actions.push({
          type: ActionType.SessionCreationFailed,
          error: makeErrorInfo(errorDetail),
        });
        notes.push({
          index,
          type: "error",
          disposition: "mapped",
          detail: "Mapped to SessionCreationFailed (no active turn)",
        });
      }
      break;
    }

    // ─── Status events ─────────────────────────────────────────────

    case "status": {
      const statusContent = content || "";
      const turnId = eventTurnId || context.turnId;

      switch (statusContent) {
        case "failed": {
          if (turnId) {
            actions.push({
              type: ActionType.SessionError,
              turnId,
              error: makeErrorInfo("Session failed during turn"),
            });
            context.turnId = undefined;
            notes.push({
              index,
              type: "status",
              disposition: "mapped",
              detail: `Mapped to SessionError (status=failed, turnId=${turnId})`,
            });
          } else {
            actions.push({
              type: ActionType.SessionCreationFailed,
              error: makeErrorInfo("Session creation failed"),
            });
            notes.push({
              index,
              type: "status",
              disposition: "mapped",
              detail: "Mapped to SessionCreationFailed (status=failed)",
            });
          }
          break;
        }

        case "killed":
        case "terminated": {
          if (turnId) {
            actions.push({
              type: ActionType.SessionError,
              turnId,
              error: makeErrorInfo(`Session ${statusContent} during turn`),
            });
            context.turnId = undefined;
            context.openToolCalls = [];
            notes.push({
              index,
              type: "status",
              disposition: "mapped",
              detail: `Mapped to SessionError (status=${statusContent})`,
            });
          } else {
            notes.push({
              index,
              type: "status",
              disposition: "dropped",
              detail: `No active turn for status=${statusContent}`,
            });
          }
          break;
        }

        case "completed":
        case "waiting_input":
        case "running": {
          notes.push({
            index,
            type: "status",
            disposition: "dropped",
            detail: `Dropped — redundant with turn_* events (status=${statusContent})`,
          });
          break;
        }

        default: {
          notes.push({
            index,
            type: "status",
            disposition: "dropped",
            detail: `Dropped — unrecognized status (${statusContent})`,
          });
        }
      }
      break;
    }

    // ─── System events ─────────────────────────────────────────────

    case "system": {
      const turnId = eventTurnId || context.turnId;

      if (isDiagnosticEvent(event)) {
        notes.push({
          index,
          type: "system",
          disposition: "carried",
          detail: "Dropped — diagnostic event routes to ahp-otlp telemetry",
        });
        break;
      }

      if (turnId) {
        actions.push({
          type: ActionType.SessionResponsePart,
          turnId,
          part: {
            kind: ResponsePartKind.SystemNotification,
            content: content || "",
          },
       });
        notes.push({
          index,
          type: "system",
          disposition: "mapped",
          detail: "Mapped to SessionResponsePart(systemNotification)",
        });
      } else {
        notes.push({
          index,
          type: "system",
          disposition: "dropped",
          detail: "No active turn for system event",
        });
      }
      break;
    }

    // ─── Internal control events ───────────────────────────────────

    case "runtime_session_id": {
      if (content) {
        context.metaAccumulator.runtimeSessionId = content;
        notes.push({
          index,
          type: "runtime_session_id",
          disposition: "carried",
          detail: "Carried as _meta.runtimeSessionId",
        });
      } else {
        notes.push({
          index,
          type: "runtime_session_id",
          disposition: "dropped",
          detail: "No content to carry",
        });
      }
      break;
    }

    // ─── Unknown event types ───────────────────────────────────────

    default: {
      notes.push({
        index,
        type,
        disposition: "dropped",
        detail: `Unrecognized event type: ${type}`,
      });
    }
  }

  return { actions, notes };
}
