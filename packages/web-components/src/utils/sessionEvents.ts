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

/** Pairs tool_use events with their tool_result counterparts. */
export function pairToolEvents(events: SessionEvent[]): DisplayEvent[] {
  const parsedRaw = new Map<SessionEvent, Record<string, unknown>>();
  for (const e of events) {
    if (!e.raw) continue;
    try {
      parsedRaw.set(e, JSON.parse(e.raw) as Record<string, unknown>);
    } catch { /* skip unparseable events */ }
  }

  // Build a map of tool_use IDs → context, supporting all runtime ID formats.
  const toolUseById = new Map<string, { tool: string; args: unknown }>();
  for (const e of events) {
    if (e.eventType !== "tool_use") continue;
    const raw = parsedRaw.get(e);
    const id = raw ? extractToolUseId(raw) : undefined;
    if (!id) continue;
    try {
      const content = JSON.parse(e.content) as { tool: string; args: unknown };
      toolUseById.set(id, { tool: content.tool, args: content.args });
    } catch { /* skip unparseable events */ }
  }

  // Phase 1: ID-based pairing — match tool_result events to tool_use by ID.
  const consumedIds = new Set<string>();
  const pairedResultIndices = new Set<number>();
  const display: DisplayEvent[] = events.map((e, index) => {
    if (e.eventType !== "tool_result") return e;
    const raw = parsedRaw.get(e);
    const resultId = raw ? extractToolResultId(raw) : undefined;
    if (!resultId) return e;
    const ctx = toolUseById.get(resultId);
    if (!ctx) return e;
    consumedIds.add(resultId);
    pairedResultIndices.add(index);

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

  // Phase 2: Sequential fallback — pair remaining unpaired tool_use with the next
  // unpaired tool_result in event order. This handles runtimes where raw IDs are
  // absent or the format is not yet recognized.
  const unpairedToolUseIndices: number[] = [];
  for (let i = 0; i < display.length; i++) {
    if (display[i].eventType !== "tool_use") continue;
    const raw = parsedRaw.get(display[i]);
    const id = raw ? extractToolUseId(raw) : undefined;
    if (id && consumedIds.has(id)) continue;
    unpairedToolUseIndices.push(i);
  }

  const unpairedResultIndices: number[] = [];
  for (let i = 0; i < display.length; i++) {
    if (display[i].eventType !== "tool_result" || pairedResultIndices.has(i)) continue;
    unpairedResultIndices.push(i);
  }

  // Match unpaired tool_use to the next unpaired tool_result that follows it.
  let resultCursor = 0;
  for (const useIdx of unpairedToolUseIndices) {
    // Advance cursor past results that appear before this tool_use
    while (resultCursor < unpairedResultIndices.length && unpairedResultIndices[resultCursor] < useIdx) {
      resultCursor++;
    }
    if (resultCursor >= unpairedResultIndices.length) break;

    const resultIdx = unpairedResultIndices[resultCursor];
    const useEvent = display[useIdx];
    const resultEvent = display[resultIdx];

    let ctx: { tool: string; args: unknown } | undefined;
    try {
      const content = JSON.parse(useEvent.content) as { tool: string; args: unknown };
      ctx = { tool: content.tool, args: content.args };
    } catch { /* skip */ }

    if (ctx) {
      // Extract detailedResult
      let detailedResult: string | undefined;
      const contentStr: string = resultEvent.content.trim();
      if (contentStr.startsWith("{")) {
        try {
          const parsed = JSON.parse(contentStr) as Record<string, unknown>;
          if (typeof parsed.detailedContent === "string") {
            detailedResult = parsed.detailedContent;
          }
        } catch { /* skip */ }
      }

      display[resultIdx] = { ...resultEvent, toolUseCtx: { ...ctx, detailedResult } };
      pairedResultIndices.add(resultIdx);

      // Mark the tool_use as consumed so it's filtered out below
      const raw = parsedRaw.get(useEvent);
      const id = raw ? extractToolUseId(raw) : undefined;
      if (id) {
        consumedIds.add(id);
      } else {
        // No ID available — use a synthetic marker to track consumption
        consumedIds.add(`__seq_${useIdx}`);
        // Store the synthetic ID so the filter below can find it
        parsedRaw.set(useEvent, { ...parsedRaw.get(useEvent), __seqId: `__seq_${useIdx}` });
      }
      resultCursor++;
    }
  }

  // Filter out consumed tool_use events (their info is now embedded in tool_result).
  const filtered = display.filter((e) => {
    if (e.eventType !== "tool_use") return true;
    const raw = parsedRaw.get(e);
    if (!raw) return true;
    const id = extractToolUseId(raw);
    if (id && consumedIds.has(id)) return false;
    // Check synthetic sequential marker
    const seqId = raw.__seqId as string | undefined;
    if (seqId && consumedIds.has(seqId)) return false;
    return true;
  });

  // Phase 3: Mark remaining unpaired tool_use events as "settled" if subsequent
  // events prove the tool completed. This handles runtimes like Claude Code that
  // emit tool results as text events rather than tool_result events — without this,
  // the ShellCard shows a misleading in-progress spinner forever.
  for (let i = 0; i < filtered.length; i++) {
    if (filtered[i].eventType !== "tool_use") continue;
    // If there are events after this tool_use, the tool must have completed
    if (i < filtered.length - 1) {
      filtered[i] = { ...filtered[i], settled: true };
    }
  }

  return filtered;
}
