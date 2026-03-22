import { describe, it, expect, beforeAll } from "vitest";
import type { Embedder } from "./embedder.js";
import { createLocalEmbedder } from "./local-embedder.js";

/** Cosine similarity between two equal-length vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot: number = 0;
  let normA: number = 0;
  let normB: number = 0;
  for (let i: number = 0; i < a.length; i++) {
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

  it("should produce higher similarity for related texts than for unrelated texts", async () => {
    const [similarA, similarB, dissimilarA, dissimilarB] = await embedder.embedBatch([
      "the cat sat on the mat",
      "a cat was sitting on a rug",
      "quantum physics and black holes",
      "chocolate cake recipe with frosting",
    ]);

    const similarScore: number = cosineSimilarity(similarA.vector, similarB.vector);
    const dissimilarScore: number = cosineSimilarity(dissimilarA.vector, dissimilarB.vector);

    expect(similarScore).toBeGreaterThan(dissimilarScore + 0.1);
  }, 60_000);
});
