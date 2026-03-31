import { describe, it, expect } from "vitest";
import {
  isContentBearingEvent,
  getEventCopyText,
  formatEventsAsMarkdown,
  formatForwardEnvelope,
} from "./eventContent.js";
import type { SessionEvent } from "../hooks/types.js";
import type { DisplayEvent } from "./sessionEvents.js";

/** Helper to build a minimal SessionEvent. */
function makeEvent(overrides: Partial<SessionEvent> & { eventType: string }): SessionEvent {
  return {
    sessionId: "sess-1",
    timestamp: "2026-01-15T14:34:00Z",
    content: "",
    ...overrides,
  };
}

/** Helper to build a DisplayEvent with optional toolUseCtx. */
function makeDisplayEvent(
  overrides: Partial<DisplayEvent> & { eventType: string },
): DisplayEvent {
  return {
    sessionId: "sess-1",
    timestamp: "2026-01-15T14:34:00Z",
    content: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isContentBearingEvent
// ---------------------------------------------------------------------------

describe("isContentBearingEvent", () => {
  it("returns true for text events", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "text" }))).toBe(true);
  });

  it("returns true for output events", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "output" }))).toBe(true);
  });

  it("returns true for user_input events", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "user_input" }))).toBe(true);
  });

  it("returns true for tool_use events", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "tool_use" }))).toBe(true);
  });

  it("returns true for tool_result events", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "tool_result" }))).toBe(true);
  });

  it("returns true for error events", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "error" }))).toBe(true);
  });

  it("returns false for status events", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "status" }))).toBe(false);
  });

  it("returns false for signal events", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "signal" }))).toBe(false);
  });

  it("returns false for usage events", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "usage" }))).toBe(false);
  });

  it("returns false for system events", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "system" }))).toBe(false);
  });

  it("returns false for unknown event types", () => {
    expect(isContentBearingEvent(makeEvent({ eventType: "unknown_future_type" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEventCopyText
// ---------------------------------------------------------------------------

describe("getEventCopyText", () => {
  it("returns content for text events", () => {
    const event = makeDisplayEvent({ eventType: "text", content: "Hello world" });
    expect(getEventCopyText(event)).toBe("Hello world");
  });

  it("returns content for user_input events", () => {
    const event = makeDisplayEvent({ eventType: "user_input", content: "Fix the bug" });
    expect(getEventCopyText(event)).toBe("Fix the bug");
  });

  it("returns content for error events", () => {
    const event = makeDisplayEvent({ eventType: "error", content: "Something broke" });
    expect(getEventCopyText(event)).toBe("Something broke");
  });

  it("extracts content from JSON-wrapped tool_result", () => {
    const event = makeDisplayEvent({
      eventType: "tool_result",
      content: JSON.stringify({ content: "file contents here" }),
    });
    expect(getEventCopyText(event)).toBe("file contents here");
  });

  it("returns raw content for plain-text tool_result", () => {
    const event = makeDisplayEvent({
      eventType: "tool_result",
      content: "plain result text",
    });
    expect(getEventCopyText(event)).toBe("plain result text");
  });

  it("formats tool_use as tool name + args", () => {
    const event = makeDisplayEvent({
      eventType: "tool_use",
      content: JSON.stringify({ tool: "Read", args: { file_path: "src/index.ts" } }),
    });
    const result = getEventCopyText(event);
    expect(result).toContain("Read");
    expect(result).toContain("src/index.ts");
  });

  it("returns raw content for unparseable tool_use", () => {
    const event = makeDisplayEvent({
      eventType: "tool_use",
      content: "not json",
    });
    expect(getEventCopyText(event)).toBe("not json");
  });
});

// ---------------------------------------------------------------------------
// formatEventsAsMarkdown
// ---------------------------------------------------------------------------

describe("formatEventsAsMarkdown", () => {
  it("returns empty string for empty array", () => {
    expect(formatEventsAsMarkdown([])).toBe("");
  });

  it("formats a single text event with Assistant label and timestamp", () => {
    const event = makeDisplayEvent({
      eventType: "text",
      content: "I found the bug.",
      timestamp: "2026-01-15T14:34:00Z",
    });
    const md = formatEventsAsMarkdown([event]);
    expect(md).toContain("**Assistant**");
    expect(md).toContain("I found the bug.");
  });

  it("formats a user_input event with User label", () => {
    const event = makeDisplayEvent({
      eventType: "user_input",
      content: "Fix the login bug",
    });
    const md = formatEventsAsMarkdown([event]);
    expect(md).toContain("**User**");
    expect(md).toContain("Fix the login bug");
  });

  it("formats a tool_result event with paired tool_use context", () => {
    const event = makeDisplayEvent({
      eventType: "tool_result",
      content: "const x = 42;",
      toolUseCtx: { tool: "Read", args: { file_path: "src/index.ts" } },
    });
    const md = formatEventsAsMarkdown([event]);
    expect(md).toContain("**Tool: Read**");
    expect(md).toContain("`src/index.ts`");
    expect(md).toContain("const x = 42;");
  });

  it("formats an unpaired tool_result with generic label", () => {
    const event = makeDisplayEvent({
      eventType: "tool_result",
      content: "some result",
    });
    const md = formatEventsAsMarkdown([event]);
    expect(md).toContain("**Tool output**");
    expect(md).toContain("some result");
  });

  it("formats an error event", () => {
    const event = makeDisplayEvent({
      eventType: "error",
      content: "Connection refused",
    });
    const md = formatEventsAsMarkdown([event]);
    expect(md).toContain("**Error**");
    expect(md).toContain("Connection refused");
  });

  it("preserves code fences within content", () => {
    const event = makeDisplayEvent({
      eventType: "text",
      content: "Here is code:\n```ts\nconst x = 42;\n```",
    });
    const md = formatEventsAsMarkdown([event]);
    expect(md).toContain("```ts");
    expect(md).toContain("const x = 42;");
    expect(md).toContain("```");
  });

  it("formats multiple events in order with blank line separation", () => {
    const events: DisplayEvent[] = [
      makeDisplayEvent({
        eventType: "user_input",
        content: "Fix the bug",
        timestamp: "2026-01-15T14:34:00Z",
      }),
      makeDisplayEvent({
        eventType: "text",
        content: "Looking into it.",
        timestamp: "2026-01-15T14:34:05Z",
      }),
    ];
    const md = formatEventsAsMarkdown(events);
    const userIdx = md.indexOf("**User**");
    const assistantIdx = md.indexOf("**Assistant**");
    expect(userIdx).toBeLessThan(assistantIdx);
    // Blank line separation
    expect(md).toContain("\n\n");
  });

  it("skips non-content-bearing events", () => {
    const events: DisplayEvent[] = [
      makeDisplayEvent({ eventType: "text", content: "Hello" }),
      makeDisplayEvent({ eventType: "status", content: "running" }),
      makeDisplayEvent({ eventType: "text", content: "World" }),
    ];
    const md = formatEventsAsMarkdown(events);
    expect(md).not.toContain("running");
    expect(md).toContain("Hello");
    expect(md).toContain("World");
  });

  it("formats a tool_use event with tool name, args summary, and JSON body", () => {
    const event = makeDisplayEvent({
      eventType: "tool_use",
      content: JSON.stringify({ tool: "Bash", args: { command: "npm test" } }),
    });
    const md = formatEventsAsMarkdown([event]);
    expect(md).toContain("**Tool: Bash**");
    expect(md).toContain("`npm test`");
    expect(md).toContain("```json");
    expect(md).toContain("npm test");
  });

  it("prefers detailedResult for tool_result in getEventCopyText", () => {
    const event = makeDisplayEvent({
      eventType: "tool_result",
      content: "short result",
      toolUseCtx: { tool: "Edit", args: {}, detailedResult: "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new" },
    });
    expect(getEventCopyText(event)).toContain("--- a/file");
  });

  it("prefers detailedResult for tool_result in formatEventsAsMarkdown", () => {
    const event = makeDisplayEvent({
      eventType: "tool_result",
      content: "short result",
      toolUseCtx: { tool: "Edit", args: {}, detailedResult: "full diff content here" },
    });
    const md = formatEventsAsMarkdown([event]);
    expect(md).toContain("full diff content here");
    expect(md).not.toContain("short result");
  });
});

// ---------------------------------------------------------------------------
// formatForwardEnvelope
// ---------------------------------------------------------------------------

describe("formatForwardEnvelope", () => {
  it("wraps content in forwarding envelope markers", () => {
    const events: DisplayEvent[] = [
      makeDisplayEvent({ eventType: "text", content: "Hello" }),
    ];
    const result = formatForwardEnvelope("my-env", events);
    expect(result).toContain("--- Forwarded from my-env ---");
    expect(result).toContain("--- End forwarded ---");
  });

  it("includes the formatted event markdown in the body", () => {
    const events: DisplayEvent[] = [
      makeDisplayEvent({ eventType: "user_input", content: "Fix the bug" }),
    ];
    const result = formatForwardEnvelope("staging", events);
    expect(result).toContain("**User**");
    expect(result).toContain("Fix the bug");
  });

  it("uses the provided sourceLabel verbatim in the header", () => {
    const result = formatForwardEnvelope("prod-env / main", [
      makeDisplayEvent({ eventType: "text", content: "done" }),
    ]);
    expect(result).toContain("--- Forwarded from prod-env / main ---");
  });

  it("envelope body starts after header and ends before footer", () => {
    const events: DisplayEvent[] = [
      makeDisplayEvent({ eventType: "text", content: "line one" }),
    ];
    const result = formatForwardEnvelope("env-1", events);
    const headerEnd = result.indexOf("--- Forwarded from env-1 ---") + "--- Forwarded from env-1 ---".length;
    const footerStart = result.indexOf("--- End forwarded ---");
    const body = result.slice(headerEnd, footerStart).trim();
    expect(body).toContain("line one");
  });

  it("skips non-content-bearing events in the body", () => {
    const events: DisplayEvent[] = [
      makeDisplayEvent({ eventType: "text", content: "visible" }),
      makeDisplayEvent({ eventType: "status", content: "running" }),
    ];
    const result = formatForwardEnvelope("env", events);
    expect(result).toContain("visible");
    expect(result).not.toContain("running");
  });

  it("formats multiple events separated by blank lines within the envelope", () => {
    const events: DisplayEvent[] = [
      makeDisplayEvent({ eventType: "user_input", content: "first" }),
      makeDisplayEvent({ eventType: "text", content: "second" }),
    ];
    const result = formatForwardEnvelope("env", events);
    expect(result).toContain("\n\n");
    expect(result).toContain("first");
    expect(result).toContain("second");
  });
});
