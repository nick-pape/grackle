/**
 * Utilities for classifying session events and formatting them for clipboard copy.
 *
 * Pure functions with no React or DOM dependencies.
 *
 * @module
 */

import type { SessionEvent } from "../hooks/types.js";
import type { DisplayEvent } from "./sessionEvents.js";

/** Event types that carry meaningful, copyable content. */
const CONTENT_BEARING_TYPES: ReadonlySet<string> = new Set([
  "text",
  "output",
  "user_input",
  "tool_use",
  "tool_result",
  "error",
]);

/**
 * Returns true when an event's type represents copyable content.
 *
 * Content-bearing: text, output, user_input, tool_use, tool_result, error.
 * Non-content: status, signal, usage, system, and anything else.
 */
export function isContentBearingEvent(event: SessionEvent): boolean {
  return CONTENT_BEARING_TYPES.has(event.eventType);
}

/**
 * Extracts the raw text that should be placed on the clipboard when a single
 * event is copied via the hover action row.
 *
 * This returns the plain content without labels or timestamps — it mirrors
 * what the old per-event CopyButton provided.
 */
export function getEventCopyText(event: DisplayEvent): string {
  switch (event.eventType) {
    case "tool_result": {
      // Prefer detailedResult when available (e.g. Copilot unified diffs)
      if (event.toolUseCtx?.detailedResult) {
        return event.toolUseCtx.detailedResult;
      }
      // When paired, the result content may be JSON-wrapped. Extract the
      // displayable content the same way EventRenderer does.
      let resultContent = event.content;
      if (event.content.trimStart().startsWith("{")) {
        try {
          const parsed = JSON.parse(event.content) as Record<string, unknown>;
          if (typeof parsed.content === "string") {
            resultContent = parsed.content;
          }
        } catch { /* use as-is */ }
      }
      return resultContent;
    }
    case "tool_use": {
      // Show the tool name and args in a readable form
      try {
        const parsed = JSON.parse(event.content) as { tool?: string; args?: unknown };
        const tool = parsed.tool ?? "tool";
        const args = parsed.args !== undefined ? JSON.stringify(parsed.args, undefined, 2) : "";
        return `${tool}\n${args}`;
      } catch {
        return event.content;
      }
    }
    default:
      return event.content;
  }
}

/** Extracts a one-line args summary for tool events (e.g. file path, command). */
function toolArgsSummary(args: unknown): string {
  if (args === null || args === undefined) {
    return "";
  }
  if (typeof args !== "object") {
    return String(args);
  }
  const obj = args as Record<string, unknown>;
  // Common arg patterns across tool cards
  if (typeof obj.command === "string") {
    return `\`${obj.command}\``;
  }
  if (typeof obj.file_path === "string" || typeof obj.filePath === "string") {
    return `\`${(obj.file_path ?? obj.filePath) as string}\``;
  }
  if (typeof obj.path === "string") {
    return `\`${obj.path}\``;
  }
  if (typeof obj.query === "string") {
    return `\`${obj.query}\``;
  }
  if (typeof obj.pattern === "string") {
    return `\`${obj.pattern}\``;
  }
  return "";
}

/**
 * Formats a list of events as well-structured markdown for clipboard copy.
 *
 * Each event gets a label and timestamp header, followed by its content.
 * Events are separated by blank lines. Non-content-bearing events are skipped.
 */
export function formatEventsAsMarkdown(events: DisplayEvent[]): string {
  const parts: string[] = [];

  for (const event of events) {
    if (!isContentBearingEvent(event)) {
      continue;
    }

    const time = new Date(event.timestamp).toLocaleTimeString();

    switch (event.eventType) {
      case "text":
      case "output": {
        parts.push(`**Assistant** (${time}):\n${event.content}`);
        break;
      }
      case "user_input": {
        parts.push(`**User** (${time}):\n${event.content}`);
        break;
      }
      case "tool_result": {
        // Prefer detailedResult (e.g. Copilot unified diffs)
        let resultContent = event.toolUseCtx?.detailedResult ?? undefined;
        if (!resultContent) {
          // Extract displayable content from JSON-wrapped results
          resultContent = event.content;
          if (event.content.trimStart().startsWith("{")) {
            try {
              const parsed = JSON.parse(event.content) as Record<string, unknown>;
              if (typeof parsed.content === "string") {
                resultContent = parsed.content;
              }
            } catch { /* use as-is */ }
          }
        }

        if (event.toolUseCtx) {
          const summary = toolArgsSummary(event.toolUseCtx.args);
          const label = summary
            ? `**Tool: ${event.toolUseCtx.tool}** ${summary}`
            : `**Tool: ${event.toolUseCtx.tool}**`;
          parts.push(`${label} (${time}):\n${resultContent}`);
        } else {
          parts.push(`**Tool output** (${time}):\n${resultContent}`);
        }
        break;
      }
      case "tool_use": {
        let tool = "tool";
        let args: unknown;
        try {
          const parsed = JSON.parse(event.content) as { tool?: string; args?: unknown };
          tool = parsed.tool ?? "tool";
          args = parsed.args;
        } catch { /* use defaults */ }
        const summary = toolArgsSummary(args);
        const label = summary ? `**Tool: ${tool}** ${summary}` : `**Tool: ${tool}**`;
        if (args !== undefined) {
          parts.push(`${label} (${time}):\n\`\`\`json\n${JSON.stringify(args, undefined, 2)}\n\`\`\``);
        } else {
          parts.push(`${label} (${time}):`);
        }
        break;
      }
      case "error": {
        parts.push(`**Error** (${time}):\n${event.content}`);
        break;
      }
      default:
        break;
    }
  }

  return parts.join("\n\n");
}
