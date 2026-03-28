import { describe, it, expect } from "vitest";
import { groupConsecutiveTextEvents, pairToolEvents } from "./sessionEvents.js";
import type { SessionEvent } from "../hooks/types.js";

/** Creates a minimal SessionEvent for testing. */
function makeEvent(overrides: Partial<SessionEvent> & { eventType: string }): SessionEvent {
  return {
    id: "evt-" + Math.random().toString(36).slice(2, 8),
    sessionId: "session-1",
    timestamp: new Date().toISOString(),
    content: "",
    ...overrides,
  } as SessionEvent;
}

describe("groupConsecutiveTextEvents", () => {
  it("merges consecutive text events", () => {
    const events = [
      makeEvent({ eventType: "text", content: "Hello " }),
      makeEvent({ eventType: "text", content: "world" }),
    ];
    const result = groupConsecutiveTextEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Hello world");
  });

  it("does not merge non-consecutive text events", () => {
    const events = [
      makeEvent({ eventType: "text", content: "first" }),
      makeEvent({ eventType: "system", content: "separator" }),
      makeEvent({ eventType: "text", content: "second" }),
    ];
    const result = groupConsecutiveTextEvents(events);
    expect(result).toHaveLength(3);
  });
});

describe("pairToolEvents", () => {
  describe("Anthropic ID format (Claude Code)", () => {
    it("pairs tool_use with tool_result by raw.id / raw.tool_use_id", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "Bash", args: { command: "ls" } }),
          raw: JSON.stringify({ type: "tool_use", id: "toolu_abc123", name: "Bash" }),
        }),
        makeEvent({
          eventType: "tool_result",
          content: "file1.txt\nfile2.txt",
          raw: JSON.stringify({ tool_use_id: "toolu_abc123", is_error: false }),
        }),
      ];
      const result = pairToolEvents(events);
      // tool_use consumed, only tool_result with context remains
      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe("tool_result");
      expect(result[0].toolUseCtx).toBeDefined();
      expect(result[0].toolUseCtx!.tool).toBe("Bash");
      expect(result[0].content).toBe("file1.txt\nfile2.txt");
    });
  });

  describe("Copilot ID format", () => {
    it("pairs tool_use with tool_result by raw.data.toolCallId", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "powershell", args: { command: "ls" } }),
          raw: JSON.stringify({
            type: "tool.execution_start",
            data: { toolCallId: "call_xyz789", toolName: "powershell" },
          }),
        }),
        makeEvent({
          eventType: "tool_result",
          content: "Directory listing...",
          raw: JSON.stringify({
            type: "tool.execution_complete",
            data: { toolCallId: "call_xyz789", success: true },
          }),
        }),
      ];
      const result = pairToolEvents(events);
      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe("tool_result");
      expect(result[0].toolUseCtx).toBeDefined();
      expect(result[0].toolUseCtx!.tool).toBe("powershell");
    });
  });

  describe("Codex ID format", () => {
    it("pairs tool_use with tool_result by raw.item.id", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "command_execution", args: { command: "ls" } }),
          raw: JSON.stringify({
            type: "item.started",
            item: { id: "item_1", type: "command_execution" },
          }),
        }),
        makeEvent({
          eventType: "tool_result",
          content: "[exit 0] file1.txt",
          raw: JSON.stringify({
            type: "item.completed",
            item: { id: "item_1", type: "command_execution" },
          }),
        }),
      ];
      const result = pairToolEvents(events);
      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe("tool_result");
      expect(result[0].toolUseCtx).toBeDefined();
      expect(result[0].toolUseCtx!.tool).toBe("command_execution");
    });
  });

  describe("adjacent fallback pairing", () => {
    it("pairs unpaired tool_use with immediately adjacent tool_result", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "Bash", args: { command: "echo hi" } }),
          // No raw metadata — cannot pair by ID
        }),
        makeEvent({
          eventType: "tool_result",
          content: "hi",
          // No raw metadata — cannot pair by ID
        }),
      ];
      const result = pairToolEvents(events);
      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe("tool_result");
      expect(result[0].toolUseCtx).toBeDefined();
      expect(result[0].toolUseCtx!.tool).toBe("Bash");
    });

    it("does not pair tool_result that appears before tool_use", () => {
      const events = [
        makeEvent({
          eventType: "tool_result",
          content: "orphan result",
        }),
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "Bash", args: { command: "ls" } }),
        }),
      ];
      const result = pairToolEvents(events);
      // Both remain unpaired
      expect(result).toHaveLength(2);
      expect(result[0].eventType).toBe("tool_result");
      expect(result[0].toolUseCtx).toBeUndefined();
      expect(result[1].eventType).toBe("tool_use");
    });

    it("does not pair non-adjacent tool_use and tool_result", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "Bash", args: { command: "ls" } }),
        }),
        makeEvent({
          eventType: "text",
          content: "some text in between",
        }),
        makeEvent({
          eventType: "tool_result",
          content: "result",
        }),
      ];
      const result = pairToolEvents(events);
      // All three remain (tool_use not consumed, text stays, tool_result unpaired)
      expect(result).toHaveLength(3);
      expect(result[0].eventType).toBe("tool_use");
      expect(result[2].eventType).toBe("tool_result");
      expect(result[2].toolUseCtx).toBeUndefined();
    });
  });

  describe("multiple tool calls", () => {
    it("pairs multiple Codex tool calls correctly", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "command_execution", args: { command: "ls" } }),
          raw: JSON.stringify({ type: "item.started", item: { id: "item_1" } }),
        }),
        makeEvent({
          eventType: "tool_result",
          content: "[exit 0] files...",
          raw: JSON.stringify({ type: "item.completed", item: { id: "item_1" } }),
        }),
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "mcp__grackle__workpad_write", args: { status: "done" } }),
          raw: JSON.stringify({ type: "item.started", item: { id: "item_2" } }),
        }),
        makeEvent({
          eventType: "tool_result",
          content: '{"taskId":"abc"}',
          raw: JSON.stringify({ type: "item.completed", item: { id: "item_2" } }),
        }),
      ];
      const result = pairToolEvents(events);
      expect(result).toHaveLength(2);
      expect(result[0].toolUseCtx!.tool).toBe("command_execution");
      expect(result[1].toolUseCtx!.tool).toBe("mcp__grackle__workpad_write");
    });
  });

  describe("detailedResult extraction", () => {
    it("extracts detailedContent from Copilot tool result JSON", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "edit", args: { file: "test.ts" } }),
          raw: JSON.stringify({ data: { toolCallId: "call_1" } }),
        }),
        makeEvent({
          eventType: "tool_result",
          content: JSON.stringify({ content: "Applied changes", detailedContent: "--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new" }),
          raw: JSON.stringify({ data: { toolCallId: "call_1" } }),
        }),
      ];
      const result = pairToolEvents(events);
      expect(result).toHaveLength(1);
      expect(result[0].toolUseCtx!.detailedResult).toBe("--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new");
    });
  });

  describe("unpaired tool_use (Claude Code text-result pattern)", () => {
    it("leaves tool_use in display when no tool_result exists", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "Bash", args: { command: "ls" } }),
          raw: JSON.stringify({ type: "tool_use", id: "toolu_abc" }),
        }),
        makeEvent({
          eventType: "text",
          content: "```\nfile1.txt\nfile2.txt\n```",
        }),
      ];
      const result = pairToolEvents(events);
      // tool_use remains (not consumed), text remains
      expect(result).toHaveLength(2);
      expect(result[0].eventType).toBe("tool_use");
      expect(result[1].eventType).toBe("text");
    });

    it("marks unpaired tool_use as settled when subsequent events exist", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "Bash", args: { command: "ls" } }),
          raw: JSON.stringify({ type: "tool_use", id: "toolu_abc" }),
        }),
        makeEvent({
          eventType: "text",
          content: "```\nfile1.txt\n```",
        }),
      ];
      const result = pairToolEvents(events);
      expect(result[0].settled).toBe(true);
    });

    it("does not mark tool_use as settled when it is the last event (still running)", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "Bash", args: { command: "npm install" } }),
          raw: JSON.stringify({ type: "tool_use", id: "toolu_xyz" }),
        }),
      ];
      const result = pairToolEvents(events);
      expect(result).toHaveLength(1);
      expect(result[0].settled).toBeUndefined();
    });

    it("does not mark tool_use as settled when only more tool_use events follow", () => {
      const events = [
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "Bash", args: { command: "ls" } }),
          raw: JSON.stringify({ type: "tool_use", id: "toolu_1" }),
        }),
        makeEvent({
          eventType: "tool_use",
          content: JSON.stringify({ tool: "Bash", args: { command: "pwd" } }),
          raw: JSON.stringify({ type: "tool_use", id: "toolu_2" }),
        }),
      ];
      const result = pairToolEvents(events);
      expect(result).toHaveLength(2);
      expect(result[0].settled).toBeUndefined();
      expect(result[1].settled).toBeUndefined();
    });
  });
});
