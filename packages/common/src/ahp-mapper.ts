/**
 * AgentEvent → AHP SessionAction mapper (AHP HR1b / RFC #1292).
 *
 * Stateless function that translates a single PowerLine `AgentEvent` (or any
 * structurally-compatible value — see {@link AgentEventFields}) into one or
 * more AHP `SessionAction` payloads. The mapper requires a {@link MapperContext}
 * from the caller to track turn state and tool-call pairing.
 *
 * Lives in `@grackle-ai/common` (not core) because both the live gRPC transport
 * (`GrpcHostTransport` in `@grackle-ai/adapter-sdk`) and the in-core delta-replay
 * path (`SessionStateManager.reconstruct`) consume it. Decoupling from
 * `powerline.AgentEvent` lets HR8d remove the gRPC path entirely without
 * touching the mapper.
 *
 * @module ahp-mapper
 */

import {
  ActionType,
  ToolCallConfirmationReason,
  ToolResultContentType,
  ResponsePartKind,
  type ErrorInfo,
  type StateAction,
  type ToolResultContent,
} from "@grackle-ai/ahp";

/**
 * Structural subset of `powerline.AgentEvent` that the mapper plus its
 * downstream consumers actually read.
 *
 * Any object with these fields can be passed to `mapAgentEvent` —
 * proto-generated `AgentEvent` messages from the live gRPC stream and plain
 * objects reconstructed from `session_actions` rows during replay both qualify.
 *
 * The fields the mapper itself reads are `type`, `content`, `toolCallId`,
 * `turnId`, and `diagnostic`. `timestamp` and `raw` are not consulted by the
 * mapper but are included here so downstream consumers (e.g. `event-processor`
 * in `@grackle-ai/core`) can convert envelopes back into `grackle.SessionEvent`
 * proto messages without re-importing the powerline types.
 */
export interface AgentEventFields {
  /** Event type discriminator (e.g. `"turn_started"`, `"tool_use"`). */
  type: string;
  /** Event payload (string, often JSON). Empty/missing maps to `""`. */
  content?: string;
  /** First-class tool call ID for `tool_use` / `tool_result` pairing (HR3). */
  toolCallId?: string;
  /** Turn ID this event belongs to (overrides the active context turn). */
  turnId?: string;
  /** `true` for diagnostic system events that route to OTLP telemetry (HR7). */
  diagnostic?: boolean;
  /** ISO-8601 timestamp string (passed through from the runtime). */
  timestamp?: string;
  /** Raw event body — opaque to the mapper, used by JSONL persistence. */
  raw?: string;
}

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
   * Monotonically increasing event index. Stored in snapshots so delta replay
   * can seed the starting index and generate consistent synthetic turn/tool IDs
   * (e.g. `turn-${index}`) for events that lack explicit IDs.
   */
  eventIndex: number;
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
  /** Mapping disposition for this event (always zero or one). */
  note?: MappingNote;
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
function isDiagnosticEvent(event: AgentEventFields): boolean {
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
function str(parsed: Record<string, unknown>, fields: string[], fallback: string): string {
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
 * | `usage` | (none — cost accumulated in `_meta`) | carried |
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
  event: AgentEventFields,
  index: number,
  context: MapperContext,
): MapResult {
  const actions: StateAction[] = [];
  let note: MappingNote | undefined;

  const { type, content, toolCallId, turnId } = event;
  // Proto string fields default to "", treat empty as undefined
  const eventTurnId = turnId || undefined;

  const parsed = safeParseContent(content);
  const hasParsed = parsed !== undefined;

  switch (type) {
    // ─── Turn lifecycle ────────────────────────────────────────────

    case "turn_started": {
      const userMessage = hasParsed ? str(parsed, ["user_message"], content || "") : content || "";
      // Always derive a fresh turnId when eventTurnId is absent — don't inherit stale context.turnId
      const derivedTurnId = eventTurnId || `turn-${index}`;

      actions.push({
        type: ActionType.SessionTurnStarted,
        turnId: derivedTurnId,
        userMessage: { text: userMessage },
      });

      context.turnId = derivedTurnId;
      context.openToolCalls = [];
      // partCounter is NOT reset here — it increments across turns so part IDs
      // are globally unique within a session (part-0, part-1, … across all turns).

      note = {
        index,
        type: "turn_started",
        disposition: "mapped",
        detail: `Mapped to SessionTurnStarted (turnId=${context.turnId})`,
      };
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

        note = {
          index,
          type: "turn_complete",
          disposition: "mapped",
          detail: `Mapped to SessionTurnComplete (turnId=${turnId})`,
        };
      } else {
        note = {
          index,
          type: "turn_complete",
          disposition: "dropped",
          detail: "No active turn to complete",
        };
      }
      break;
    }

    // ─── Dropped: advisory only ────────────────────────────────────

    case "input_needed": {
      note = {
        index,
        type: "input_needed",
        disposition: "dropped",
        detail: "Advisory event — no structured elicitation content yet",
      };
      break;
    }

    // ─── Response parts ────────────────────────────────────────────

    case "text": {
      const turnId = eventTurnId || context.turnId;
      if (!turnId) {
        note = {
          index,
          type: "text",
          disposition: "dropped",
          detail: "No active turn for text part",
        };
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

      note = {
        index,
        type: "text",
        disposition: "mapped",
        detail: `Mapped to SessionResponsePart (partId=${partId})`,
      };
      break;
    }

    // ─── Tool calls ────────────────────────────────────────────────

    case "tool_use": {
      const turnId = eventTurnId || context.turnId;
      if (!turnId) {
        note = {
          index,
          type: "tool_use",
          disposition: "dropped",
          detail: "No active turn for tool_use",
        };
        break;
      }

      const toolCallIdValue = toolCallId || `tc-${context.partCounter++}`;
      const toolName = hasParsed
        ? str(parsed, ["tool_name", "name"], "unknown_tool")
        : "unknown_tool";
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

      note = {
        index,
        type: "tool_use",
        disposition: "mapped",
        detail: `Mapped to SessionToolCallStart + SessionToolCallReady (toolCallId=${toolCallIdValue})`,
      };
      break;
    }

    case "tool_result": {
      const turnId = eventTurnId || context.turnId;
      if (!turnId) {
        note = {
          index,
          type: "tool_result",
          disposition: "dropped",
          detail: "No active turn for tool_result",
        };
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
        note = {
          index,
          type: "tool_result",
          disposition: "dropped",
          detail: "No matching tool call for result",
        };
        break;
      }

      const isOk = hasParsed
        ? "is_ok" in parsed
          ? parsed.is_ok === true
          : "success" in parsed
            ? parsed.success === true
            : true
        : true;
      const pastTenseMessage = hasParsed
        ? str(parsed, ["past_tense_message"], content || "")
        : content || "";
      const resultText = hasParsed ? str(parsed, ["content"], content || "") : content || "";

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
        const displayText = resultText.length > 200 ? resultText.slice(0, 200) + "..." : resultText;
        actions.push({
          type: ActionType.SessionResponsePart,
          turnId,
          part: {
            kind: ResponsePartKind.SystemNotification,
            content: displayText,
          },
        });
      }

      note = {
        index,
        type: "tool_result",
        disposition: "mapped",
        detail: `Mapped to SessionToolCallComplete (toolCallId=${pairedToolCallId})`,
      };
      break;
    }

    // ─── Usage (carried via _meta) ─────────────────────────────────

    case "usage": {
      const rawCost = hasParsed ? parsed.cost_millicents : undefined;
      // eslint-disable-next-line eqeqeq -- `!= null` checks both null and undefined in one expression
      if (rawCost != null && Number.isFinite(Number(rawCost))) {
        const prevCost = context.metaAccumulator.costMillicents ?? 0;
        const cost = Number(rawCost);
        context.metaAccumulator.costMillicents = Math.max(0, prevCost + Math.trunc(cost));
      }

      note = {
        index,
        type: "usage",
        disposition: "carried",
        detail: `Usage tracked — costMillicents now ${context.metaAccumulator.costMillicents ?? 0}`,
      };
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
        note = {
          index,
          type: "error",
          disposition: "mapped",
          detail: `Mapped to SessionError (turnId=${turnId})`,
        };
        context.turnId = undefined;
      } else {
        actions.push({
          type: ActionType.SessionCreationFailed,
          error: makeErrorInfo(errorDetail),
        });
        note = {
          index,
          type: "error",
          disposition: "mapped",
          detail: "Mapped to SessionCreationFailed (no active turn)",
        };
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
            note = {
              index,
              type: "status",
              disposition: "mapped",
              detail: `Mapped to SessionError (status=failed, turnId=${turnId})`,
            };
          } else {
            actions.push({
              type: ActionType.SessionCreationFailed,
              error: makeErrorInfo("Session creation failed"),
            });
            note = {
              index,
              type: "status",
              disposition: "mapped",
              detail: "Mapped to SessionCreationFailed (status=failed)",
            };
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
            note = {
              index,
              type: "status",
              disposition: "mapped",
              detail: `Mapped to SessionError (status=${statusContent})`,
            };
          } else {
            note = {
              index,
              type: "status",
              disposition: "dropped",
              detail: `No active turn for status=${statusContent}`,
            };
          }
          break;
        }

        case "completed":
        case "waiting_input":
        case "running": {
          note = {
            index,
            type: "status",
            disposition: "dropped",
            detail: `Dropped — redundant with turn_* events (status=${statusContent})`,
          };
          break;
        }

        default: {
          note = {
            index,
            type: "status",
            disposition: "dropped",
            detail: `Dropped — unrecognized status (${statusContent})`,
          };
        }
      }
      break;
    }

    // ─── System events ─────────────────────────────────────────────

    case "system": {
      const turnId = eventTurnId || context.turnId;

      if (isDiagnosticEvent(event)) {
        note = {
          index,
          type: "system",
          disposition: "carried",
          detail: "Dropped — diagnostic event routes to ahp-otlp telemetry",
        };
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
        note = {
          index,
          type: "system",
          disposition: "mapped",
          detail: "Mapped to SessionResponsePart(systemNotification)",
        };
      } else {
        note = {
          index,
          type: "system",
          disposition: "dropped",
          detail: "No active turn for system event",
        };
      }
      break;
    }

    // ─── Internal control events ───────────────────────────────────

    case "runtime_session_id": {
      if (content) {
        context.metaAccumulator.runtimeSessionId = content;
        note = {
          index,
          type: "runtime_session_id",
          disposition: "carried",
          detail: "Carried as _meta.runtimeSessionId",
        };
      } else {
        note = {
          index,
          type: "runtime_session_id",
          disposition: "dropped",
          detail: "No content to carry",
        };
      }
      break;
    }

    // ─── Unknown event types ───────────────────────────────────────

    default: {
      note = {
        index,
        type,
        disposition: "dropped",
        detail: `Unrecognized event type: ${type}`,
      };
    }
  }

  return { actions, note };
}
