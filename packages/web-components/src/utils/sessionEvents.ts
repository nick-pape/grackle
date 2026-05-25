import type { SessionEvent } from "../hooks/types.js";

/** Session event augmented with optional tool_use context for paired tool results. */
export type DisplayEvent = SessionEvent & {
  toolUseCtx?: { tool: string; args: unknown; detailedResult?: string };
  /**
   * True when a tool_use event has no matching tool_result but subsequent events
   * prove the tool completed (e.g. Claude Code emits results as text, not tool_result).
   * EventRenderer uses this to avoid showing a misleading in-progress spinner.
   */
  settled?: boolean;
};

/** Merges consecutive "text" events into single entries with concatenated content. */
export function groupConsecutiveTextEvents(events: SessionEvent[]): SessionEvent[] {
  const result: SessionEvent[] = [];
  for (const event of events) {
    const previous = result[result.length - 1];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- previous is undefined on first iteration
    if (event.eventType === "text" && previous?.eventType === "text") {
      result[result.length - 1] = { ...previous, content: previous.content + event.content };
    } else {
      result.push(event);
    }
  }
  return result;
}

/**
 * Extracts the tool-use ID from a tool_use event's raw metadata.
 *
 * Different runtimes store the ID in different locations:
 * - Claude Code (Anthropic SDK): `raw.id` (e.g. "toolu_...")
 * - Copilot: `raw.data.toolCallId` (e.g. "call_...")
 * - Codex: `raw.item.id` (e.g. "item_1")
 */
function extractToolUseId(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.id === "string") {
    return raw.id;
  }
  const data = raw.data as Record<string, unknown> | undefined;
  if (data && typeof data.toolCallId === "string") {
    return data.toolCallId;
  }
  const item = raw.item as Record<string, unknown> | undefined;
  if (item && typeof item.id === "string") {
    return item.id;
  }
  return undefined;
}

/**
 * Extracts the tool-use ID from a tool_result event's raw metadata.
 *
 * Different runtimes store the back-reference in different locations:
 * - Claude Code (Anthropic SDK): `raw.tool_use_id`
 * - Copilot: `raw.data.toolCallId`
 * - Codex: `raw.item.id`
 */
function extractToolResultId(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.tool_use_id === "string") {
    return raw.tool_use_id;
  }
  const data = raw.data as Record<string, unknown> | undefined;
  if (data && typeof data.toolCallId === "string") {
    return data.toolCallId;
  }
  const item = raw.item as Record<string, unknown> | undefined;
  if (item && typeof item.id === "string") {
    return item.id;
  }
  return undefined;
}

/**
 * Resolve a tool event's correlation id: prefer the first-class `toolCallId`
 * (AHP HR3), falling back to the legacy per-runtime `raw` parsing for events
 * logged before HR3. `extractId` is the legacy reader for the event's role.
 */
function toolIdOf(
  e: SessionEvent,
  raw: Record<string, unknown> | undefined,
  extractId: (raw: Record<string, unknown>) => string | undefined,
): string | undefined {
  if (e.toolCallId) {
    return e.toolCallId;
  }
  return raw ? extractId(raw) : undefined;
}

/** Pairs tool_use events with their tool_result counterparts. */
export function pairToolEvents(events: SessionEvent[]): DisplayEvent[] {
  const parsedRaw = new Map<SessionEvent, Record<string, unknown>>();
  for (const e of events) {
    if (!e.raw) continue;
    try {
      parsedRaw.set(e, JSON.parse(e.raw) as Record<string, unknown>);
    } catch { /* skip unparseable events */ }
  }

  // Build a map of tool_use IDs → context (first-class toolCallId, else legacy raw).
  const toolUseById = new Map<string, { tool: string; args: unknown }>();
  for (const e of events) {
    if (e.eventType !== "tool_use") continue;
    const id = toolIdOf(e, parsedRaw.get(e), extractToolUseId);
    if (!id) continue;
    try {
      const content = JSON.parse(e.content) as { tool: string; args: unknown };
      toolUseById.set(id, { tool: content.tool, args: content.args });
    } catch { /* skip unparseable events */ }
  }

  // ID-based pairing — match tool_result events to their tool_use by id. Every
  // runtime now emits a stable `toolCallId`, so there is no positional fallback
  // (which mispaired under concurrent/interleaved tool calls — AHP HR3).
  const consumedIds = new Set<string>();
  const display: DisplayEvent[] = events.map((e) => {
    if (e.eventType !== "tool_result") return e;
    const resultId = toolIdOf(e, parsedRaw.get(e), extractToolResultId);
    if (!resultId) return e;
    const ctx = toolUseById.get(resultId);
    if (!ctx) return e;
    consumedIds.add(resultId);

    // Extract detailedResult from content when it's a JSON object with detailedContent
    // (Copilot emits tool results in this format with embedded diffs).
    // Guard with startsWith check to avoid throwing on plain text / large outputs.
    let detailedResult: string | undefined;
    const contentStr: string = e.content.trim();
    if (contentStr.startsWith("{")) {
      try {
        const parsed = JSON.parse(contentStr) as Record<string, unknown>;
        if (typeof parsed.detailedContent === "string") {
          detailedResult = parsed.detailedContent;
        }
      } catch { /* content looks like JSON but isn't — skip */ }
    }

    return { ...e, toolUseCtx: { ...ctx, detailedResult } };
  });

  // Filter out consumed tool_use events (their info is now embedded in tool_result).
  const filtered = display.filter((e) => {
    if (e.eventType !== "tool_use") return true;
    const id = toolIdOf(e, parsedRaw.get(e), extractToolUseId);
    return !(id && consumedIds.has(id));
  });

  // Phase 3: Mark remaining unpaired tool_use events as "settled" if subsequent
  // events prove the tool completed. This handles runtimes like Claude Code that
  // emit tool results as text events rather than tool_result events — without this,
  // the ShellCard shows a misleading in-progress spinner forever.
  for (let i = 0; i < filtered.length; i++) {
    if (filtered[i].eventType !== "tool_use") continue;
    // Only settle if there is at least one subsequent non-tool_use event.
    // This avoids prematurely settling in multi-tool sequences where only
    // more tool_use events follow (the tools may still be running).
    let hasNonToolUseAfter = false;
    for (let j = i + 1; j < filtered.length; j++) {
      if (filtered[j].eventType !== "tool_use") {
        hasNonToolUseAfter = true;
        break;
      }
    }
    if (hasNonToolUseAfter) {
      filtered[i] = { ...filtered[i], settled: true };
    }
  }

  return filtered;
}
