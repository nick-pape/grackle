import type { AgentEventType } from "@grackle-ai/common";
import type { AgentEvent } from "./runtime.js";

// ─── Step Types ─────────────────────────────────────────────

/** A step that emits an AgentEvent. */
export interface EmitStep {
  emit: AgentEventType;
  content?: string;
  /** Convenience: auto-serialized into content for tool_use events. */
  tool?: string;
  /** Convenience: auto-serialized into content for tool_use events. */
  args?: Record<string, unknown>;
  /** Convenience: used as finding/subtask title. */
  title?: string;
  /** Convenience: used as subtask description. */
  description?: string;
  /** Convenience: subtask local_id for dependency resolution. */
  local_id?: string;
  /** Convenience: subtask depends_on local_ids. */
  depends_on?: string[];
  /** Convenience: whether the subtask can decompose further. */
  can_decompose?: boolean;
  /** Forwarded verbatim to AgentEvent.raw. */
  raw?: unknown;
}

/** A step that pauses execution for N milliseconds. */
export interface WaitStep {
  wait: number;
}

/** A step that goes idle and waits for user input. */
export interface IdleStep {
  idle: true;
}

/** Sets the default input handling mode for subsequent idle steps. */
export interface OnInputStep {
  on_input: InputAction;
}

/** Pattern-match input text to actions. `"*"` is the fallback. */
export interface OnInputMatchStep {
  on_input_match: Record<string, InputAction>;
}

/** A step that makes a real MCP tool call via the broker. Requires mcpBroker in SpawnOptions. */
export interface McpCallStep {
  mcp_call: string;
  args?: Record<string, unknown>;
}

/** Actions that can be taken when user input is received during an idle step. */
export type InputAction = "echo" | "fail" | "ignore" | "next";

/** A single step in a scenario. */
export type ScenarioStep = EmitStep | WaitStep | IdleStep | OnInputStep | OnInputMatchStep | McpCallStep;

/** A JSON scenario that defines the exact sequence of events for a stub session. */
export interface Scenario {
  steps: ScenarioStep[];
}

// ─── Step Type Guards ───────────────────────────────────────

/** Check if a step is an EmitStep. */
export function isEmitStep(step: ScenarioStep): step is EmitStep {
  return "emit" in step;
}

/** Check if a step is a WaitStep. */
export function isWaitStep(step: ScenarioStep): step is WaitStep {
  return "wait" in step;
}

/** Check if a step is an IdleStep. */
export function isIdleStep(step: ScenarioStep): step is IdleStep {
  return "idle" in step;
}

/** Check if a step is an OnInputStep. */
export function isOnInputStep(step: ScenarioStep): step is OnInputStep {
  return "on_input" in step;
}

/** Check if a step is an OnInputMatchStep. */
export function isOnInputMatchStep(step: ScenarioStep): step is OnInputMatchStep {
  return "on_input_match" in step;
}

/** Check if a step is an McpCallStep. */
export function isMcpCallStep(step: ScenarioStep): step is McpCallStep {
  return "mcp_call" in step;
}

// ─── Parser ─────────────────────────────────────────────────

/** Prefix used to embed a scenario inside a larger prompt (e.g. task title + description). */
const SCENARIO_PREFIX_RE: RegExp = /SCENARIO:\s*/i;

/**
 * Attempt to extract a Scenario from the prompt string.
 *
 * Detection rules:
 * 1. If the trimmed prompt starts with `{`, try to parse the entire prompt as JSON.
 * 2. If any line contains `SCENARIO:`, parse everything after that prefix.
 * 3. Otherwise return `undefined` (caller falls back to legacy echo behavior).
 *
 * Returns `undefined` on parse failure or if the parsed object lacks a `steps` array.
 */
export function parseScenario(prompt: string): Scenario | undefined {
  const trimmed = prompt.trim();

  // Case 1: entire prompt is JSON
  if (trimmed.startsWith("{")) {
    return tryParse(trimmed);
  }

  // Case 2: SCENARIO: prefix somewhere in the prompt
  const match = SCENARIO_PREFIX_RE.exec(trimmed);
  if (match) {
    const jsonPart = trimmed.slice(match.index + match[0].length).trim();
    return tryParse(jsonPart);
  }

  // Case 3: prompt is multi-line (e.g. "title\n\n{...}") — find the first
  // line starting with "{" and try to parse everything from that line onward.
  // This handles prompts built by buildTaskPrompt(title, description) where
  // the description is the scenario JSON, which may be single-line or
  // pretty-printed across multiple lines.
  const lines = trimmed.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("{")) {
      const jsonBlock = lines.slice(i).join("\n").trim();
      const result = tryParse(jsonBlock);
      if (result) {
        return result;
      }
    }
  }

  return undefined;
}

/** Try to parse JSON and validate it has a steps array. */
function tryParse(json: string): Scenario | undefined {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (Array.isArray(parsed.steps)) {
      return parsed as unknown as Scenario;
    }
  } catch {
    // Invalid JSON — fall through
  }
  return undefined;
}

// ─── Emit Step Normalization ────────────────────────────────

/** Auto-incrementing counter for generating unique tool_use IDs within a scenario. */
let toolUseCounter: number = 0;

/** Reset the tool_use counter (for testing). */
export function resetToolUseCounter(): void {
  toolUseCounter = 0;
}

/**
 * Build an AgentEvent from an EmitStep, applying convenience field normalization:
 *
 * - `tool_use` with `tool`/`args` → auto-generates content and raw
 * - `tool_result` without raw → auto-generates raw with `tool_use_id` from the last tool_use
 * - `subtask_create` with `title`/`description` → builds content JSON
 *
 * @param step The emit step to normalize.
 * @param lastToolUseId The ID of the most recent tool_use event, for pairing tool_results.
 * @returns A tuple of [AgentEvent, toolUseId if this was a tool_use step].
 */
export function buildEventFromEmitStep(
  step: EmitStep,
  lastToolUseId: string | undefined,
): [AgentEvent, string | undefined] {
  const timestamp = new Date().toISOString();
  let content = step.content ?? "";
  let raw = step.raw;
  let newToolUseId: string | undefined;

  if (step.emit === "tool_use" && step.tool) {
    const id = `toolu_scenario_${++toolUseCounter}`;
    newToolUseId = id;
    content = content || JSON.stringify({ tool: step.tool, args: step.args ?? {} });
    if (raw === undefined) {
      raw = { type: "tool_use", id, name: step.tool, input: step.args ?? {} };
    }
  }

  if (step.emit === "tool_result" && raw === undefined) {
    raw = {
      type: "tool_result",
      tool_use_id: lastToolUseId ?? "unknown",
      is_error: false,
    };
  }

  if (step.emit === "subtask_create" && !content && (step.title || step.description)) {
    const subtaskPayload: Record<string, unknown> = {
      title: step.title ?? "",
      description: step.description ?? "",
    };
    if (step.local_id) {
      subtaskPayload.local_id = step.local_id;
    }
    if (step.depends_on) {
      subtaskPayload.depends_on = step.depends_on;
    }
    if (step.can_decompose !== undefined) {
      subtaskPayload.can_decompose = step.can_decompose;
    }
    content = JSON.stringify(subtaskPayload);
  }

  const event: AgentEvent = { type: step.emit, timestamp, content };
  if (raw !== undefined) {
    event.raw = raw;
  }

  return [event, newToolUseId];
}
