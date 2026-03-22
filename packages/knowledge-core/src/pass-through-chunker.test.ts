import { describe, it, expect } from "vitest";
import { createPassThroughChunker } from "./pass-through-chunker.js";

describe("createPassThroughChunker", () => {
  const chunker = createPassThroughChunker();

  it("should return a single chunk with the full content", () => {
    const chunks = chunker.chunk("hello world");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("hello world");
    expect(chunks[0].index).toBe(0);
  });

  it("should pass through metadata", () => {
    const meta = { source: "test", priority: 1 };
    const chunks = chunker.chunk("some content", meta);
    expect(chunks[0].metadata).toEqual(meta);
  });

  it("should return undefined metadata when none provided", () => {
    const chunks = chunker.chunk("no metadata");
    expect(chunks[0].metadata).toBeUndefined();
  });

  it("should handle empty string", () => {
    const chunks = chunker.chunk("");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("");
    expect(chunks[0].index).toBe(0);
  });
});
