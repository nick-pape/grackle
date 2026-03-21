import { describe, it, expect, beforeAll } from "vitest";
import type { Embedder } from "./embedder.js";
import { createLocalEmbedder } from "./local-embedder.js";

/** Cosine similarity between two equal-length vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

describe("createLocalEmbedder", () => {
  let embedder: Embedder;

  beforeAll(() => {
    embedder = createLocalEmbedder();
  });

  it("should return an embedder with the expected dimensions", () => {
    expect(embedder.dimensions).toBe(384);
  });

  it("should embed a single text and return a vector of correct length", async () => {
    const result = await embedder.embed("hello world");
    expect(result.text).toBe("hello world");
    expect(result.vector).toHaveLength(384);
    expect(result.vector.every((v) => typeof v === "number" && isFinite(v))).toBe(true);
  }, 60_000);

  it("should embed multiple texts in batch", async () => {
    const results = await embedder.embedBatch(["foo", "bar", "baz"]);
    expect(results).toHaveLength(3);
    expect(results[0].text).toBe("foo");
    expect(results[1].text).toBe("bar");
    expect(results[2].text).toBe("baz");
    for (const result of results) {
      expect(result.vector).toHaveLength(384);
    }
  }, 60_000);

  it("should produce similar vectors for similar texts", async () => {
    const [a, b] = await embedder.embedBatch([
      "the cat sat on the mat",
      "a cat was sitting on a rug",
    ]);
    const similarity = cosineSimilarity(a.vector, b.vector);
    expect(similarity).toBeGreaterThan(0.7);
  }, 60_000);

  it("should produce dissimilar vectors for unrelated texts", async () => {
    const [a, b] = await embedder.embedBatch([
      "quantum physics and black holes",
      "chocolate cake recipe with frosting",
    ]);
    const similarity = cosineSimilarity(a.vector, b.vector);
    expect(similarity).toBeLessThan(0.5);
  }, 60_000);
});
