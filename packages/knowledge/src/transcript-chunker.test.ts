import { describe, it, expect } from "vitest";
import { createTranscriptChunker } from "./transcript-chunker.js";

/** Build a JSONL string from an array of partial log entries. */
function toJsonl(
  entries: Array<{ type: string; content: string; timestamp?: string }>,
): string {
  return entries
    .map((e, i) => JSON.stringify({
      session_id: "test-session",
      type: e.type,
      timestamp: e.timestamp ?? `2026-03-21T10:00:0${i}Z`,
      content: e.content,
    }))
    .join("\n");
}

describe("createTranscriptChunker", () => {
  const chunker = createTranscriptChunker();

  it("should produce one chunk for a single turn", () => {
    const jsonl: string = toJsonl([
      { type: "user_input", content: "What is authentication?" },
      { type: "text", content: "Authentication is the process of verifying identity." },
    ]);

    const chunks = chunker.chunk(jsonl);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("User: What is authentication?");
    expect(chunks[0].text).toContain("Assistant: Authentication is the process");
    expect(chunks[0].index).toBe(0);
  });

  it("should produce one chunk per turn for multi-turn conversations", () => {
    const jsonl: string = toJsonl([
      { type: "user_input", content: "Hello" },
      { type: "text", content: "Hi there!" },
      { type: "user_input", content: "How are you?" },
      { type: "text", content: "I'm doing well." },
      { type: "user_input", content: "Goodbye" },
      { type: "text", content: "See you later!" },
    ]);

    const chunks = chunker.chunk(jsonl);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].text).toContain("User: Hello");
    expect(chunks[1].text).toContain("User: How are you?");
    expect(chunks[2].text).toContain("User: Goodbye");
  });

  it("should skip status, signal, usage, and system events by default", () => {
    const jsonl: string = toJsonl([
      { type: "system", content: "You are a helpful assistant..." },
      { type: "user_input", content: "Do something" },
      { type: "status", content: "running" },
      { type: "text", content: "Done!" },
      { type: "usage", content: '{"input_tokens": 100}' },
      { type: "signal", content: "SIGINT" },
    ]);

    const chunks = chunker.chunk(jsonl);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).not.toContain("system");
    expect(chunks[0].text).not.toContain("running");
    expect(chunks[0].text).not.toContain("input_tokens");
    expect(chunks[0].text).not.toContain("SIGINT");
  });

  it("should include tool_use and tool_result events in chunks", () => {
    const jsonl: string = toJsonl([
      { type: "user_input", content: "Read the file" },
      { type: "tool_use", content: "read_file(path=/foo.ts)" },
      { type: "tool_result", content: "const x = 1;" },
      { type: "text", content: "The file contains a variable x." },
    ]);

    const chunks = chunker.chunk(jsonl);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("Tool: read_file");
    expect(chunks[0].text).toContain("Result: const x = 1;");
  });

  it("should attach metadata with timestamps and event types", () => {
    const jsonl: string = toJsonl([
      { type: "user_input", content: "Hi", timestamp: "2026-03-21T10:00:00Z" },
      { type: "text", content: "Hello", timestamp: "2026-03-21T10:00:05Z" },
    ]);

    const chunks = chunker.chunk(jsonl, { sessionId: "sess-123" });
    const meta = chunks[0].metadata as Record<string, unknown>;
    expect(meta.sessionId).toBe("sess-123");
    expect(meta.turnIndex).toBe(0);
    expect(meta.timestampStart).toBe("2026-03-21T10:00:00Z");
    expect(meta.timestampEnd).toBe("2026-03-21T10:00:05Z");
    expect(meta.eventTypes).toContain("user_input");
    expect(meta.eventTypes).toContain("text");
  });

  it("should split a long turn into sub-chunks", () => {
    const smallChunker = createTranscriptChunker({ maxChunkSize: 100 });
    const longContent: string = "A".repeat(80);
    const jsonl: string = toJsonl([
      { type: "user_input", content: "Do something big" },
      { type: "text", content: longContent },
      { type: "text", content: longContent },
    ]);

    const chunks = smallChunker.chunk(jsonl);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(110); // allow slight overflow for line that can't split
    }
  });

  it("should handle events before the first user_input as turn 0", () => {
    const jsonl: string = toJsonl([
      { type: "text", content: "Welcome!" },
      { type: "user_input", content: "Hello" },
      { type: "text", content: "Hi!" },
    ]);

    const chunks = chunker.chunk(jsonl);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("Assistant: Welcome!");
    expect(chunks[1].text).toContain("User: Hello");
  });

  it("should return empty array for empty input", () => {
    expect(chunker.chunk("")).toEqual([]);
    expect(chunker.chunk("\n\n")).toEqual([]);
  });

  it("should skip malformed JSONL lines gracefully", () => {
    const jsonl: string = '{"type":"user_input","content":"Hi","session_id":"s","timestamp":"t"}\nnot-json\n{"type":"text","content":"Hello","session_id":"s","timestamp":"t"}';
    const chunks = chunker.chunk(jsonl);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("User: Hi");
    expect(chunks[0].text).toContain("Assistant: Hello");
  });

  it("should allow custom skip types", () => {
    const customChunker = createTranscriptChunker({ skipEventTypes: ["text"] });
    const jsonl: string = toJsonl([
      { type: "user_input", content: "Do something" },
      { type: "text", content: "This should be skipped" },
      { type: "tool_use", content: "some_tool()" },
    ]);

    const chunks = customChunker.chunk(jsonl);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).not.toContain("This should be skipped");
    expect(chunks[0].text).toContain("Tool: some_tool()");
  });

  it("should return empty array when all events are skipped", () => {
    const jsonl: string = toJsonl([
      { type: "status", content: "running" },
      { type: "usage", content: '{"tokens": 50}' },
    ]);

    expect(chunker.chunk(jsonl)).toEqual([]);
  });
});
