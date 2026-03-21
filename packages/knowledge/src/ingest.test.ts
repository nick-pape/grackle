import { describe, it, expect } from "vitest";
import type { Embedder, EmbeddingResult } from "./embedder.js";
import { createPassThroughChunker } from "./pass-through-chunker.js";
import { ingest } from "./ingest.js";

/** Mock embedder that returns deterministic fake vectors. */
function createMockEmbedder(dimensions: number = 3): Embedder {
  return {
    dimensions,
    async embed(text: string): Promise<EmbeddingResult> {
      return { text, vector: Array.from({ length: dimensions }, (_, i) => i + text.length) };
    },
    async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
      return texts.map((text) => ({
        text,
        vector: Array.from({ length: dimensions }, (_, i) => i + text.length),
      }));
    },
  };
}

describe("ingest", () => {
  const chunker = createPassThroughChunker();
  const embedder = createMockEmbedder(4);

  it("should chunk and embed content in one pipeline", async () => {
    const results = await ingest("hello world", chunker, embedder);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("hello world");
    expect(results[0].index).toBe(0);
    expect(results[0].vector).toHaveLength(4);
  });

  it("should pass metadata through to chunks", async () => {
    const meta = { source: "finding" };
    const results = await ingest("some insight", chunker, embedder, meta);
    expect(results[0].metadata).toEqual(meta);
  });

  it("should work with a multi-chunk chunker", async () => {
    const multiChunker = {
      chunk(content: string) {
        return content.split("\n").map((text, index) => ({ text, index }));
      },
    };
    const results = await ingest("line one\nline two\nline three", multiChunker, embedder);
    expect(results).toHaveLength(3);
    expect(results[0].text).toBe("line one");
    expect(results[1].text).toBe("line two");
    expect(results[2].text).toBe("line three");
    for (const result of results) {
      expect(result.vector).toHaveLength(4);
    }
  });

  it("should return empty array when chunker produces no chunks", async () => {
    const emptyChunker = { chunk() { return []; } };
    const results = await ingest("ignored", emptyChunker, embedder);
    expect(results).toEqual([]);
  });
});
