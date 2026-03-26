import type { SessionEvent } from "../hooks/useGrackleSocket.js";

/** Session event augmented with optional tool_use context for paired tool results. */
export type DisplayEvent = SessionEvent & { toolUseCtx?: { tool: string; args: unknown; detailedResult?: string } };

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

/** Pairs tool_use events with their tool_result counterparts. */
export function pairToolEvents(events: SessionEvent[]): DisplayEvent[] {
  const parsedRaw = new Map<SessionEvent, Record<string, unknown>>();
  for (const e of events) {
    if (!e.raw) continue;
    try {
      parsedRaw.set(e, JSON.parse(e.raw) as Record<string, unknown>);
    } catch { /* skip unparseable events */ }
  }

  const toolUseById = new Map<string, { tool: string; args: unknown }>();
  for (const e of events) {
    if (e.eventType !== "tool_use") continue;
    const raw = parsedRaw.get(e);
    if (!raw || typeof raw.id !== "string") continue;
    try {
      const content = JSON.parse(e.content) as { tool: string; args: unknown };
      toolUseById.set(raw.id, { tool: content.tool, args: content.args });
    } catch { /* skip unparseable events */ }
  }

  const consumedIds = new Set<string>();
  const display: DisplayEvent[] = events.map((e) => {
    if (e.eventType !== "tool_result") return e;
    const raw = parsedRaw.get(e);
    if (!raw || typeof raw.tool_use_id !== "string") return e;
    const ctx = toolUseById.get(raw.tool_use_id);
    if (!ctx) return e;
    consumedIds.add(raw.tool_use_id);

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

  return display.filter((e) => {
    if (e.eventType !== "tool_use") return true;
    const raw = parsedRaw.get(e);
    if (raw && typeof raw.id === "string") return !consumedIds.has(raw.id);
    return true;
  });
}
