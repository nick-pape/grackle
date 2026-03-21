/**
 * Local ONNX-based embedder using `@huggingface/transformers`.
 *
 * Downloads and caches a HuggingFace model on first use, then runs
 * inference locally on CPU — no API keys or external services required.
 *
 * @module
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type { Embedder, EmbedderOptions, EmbeddingResult } from "./embedder.js";

/** Default model: small, fast, good general-purpose English embeddings. */
const DEFAULT_MODEL_ID: string = "Xenova/all-MiniLM-L6-v2";

/** Default embedding dimensions for the default model. */
const DEFAULT_DIMENSIONS: number = 384;

/**
 * Create a local embedder that runs ONNX inference via `@huggingface/transformers`.
 *
 * The underlying pipeline is lazily initialized on the first call to
 * {@link Embedder.embed | embed()} or {@link Embedder.embedBatch | embedBatch()}.
 * This avoids blocking construction with a model download.
 *
 * @param options - Optional configuration for model selection and dimensions.
 * @returns An {@link Embedder} instance backed by local ONNX inference.
 */
export function createLocalEmbedder(options?: EmbedderOptions): Embedder {
  const modelId = options?.modelId ?? DEFAULT_MODEL_ID;
  const dimensions = options?.dimensions ?? DEFAULT_DIMENSIONS;

  let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

  /**
   * Lazily initialise the feature-extraction pipeline.
   * Concurrent calls share the same promise so the model is loaded once.
   */
  function getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!pipelinePromise) {
      pipelinePromise = initPipeline(modelId);
    }
    return pipelinePromise;
  }

  return {
    dimensions,

    async embed(text: string): Promise<EmbeddingResult> {
      const pipe = await getPipeline();
      const output = await pipe(text, { pooling: "mean", normalize: true });
      const vector = Array.from(output.data as Float32Array);

      if (dimensions && vector.length !== dimensions) {
        throw new Error(
          `Dimension mismatch: expected ${dimensions}, got ${vector.length}. ` +
          `Check that the model "${modelId}" produces ${dimensions}-dim vectors.`
        );
      }

      return { text, vector };
    },

    async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
      const pipe = await getPipeline();
      const results: EmbeddingResult[] = [];

      for (const text of texts) {
        const output = await pipe(text, { pooling: "mean", normalize: true });
        const vector = Array.from(output.data as Float32Array);

        if (dimensions && vector.length !== dimensions) {
          throw new Error(
            `Dimension mismatch: expected ${dimensions}, got ${vector.length}. ` +
            `Check that the model "${modelId}" produces ${dimensions}-dim vectors.`
          );
        }

        results.push({ text, vector });
      }

      return results;
    },
  };
}

/**
 * Dynamically import `@huggingface/transformers` and create the pipeline.
 *
 * Uses dynamic import so the heavy ONNX runtime is only loaded when needed.
 */
async function initPipeline(modelId: string): Promise<FeatureExtractionPipeline> {
  const { pipeline } = await import("@huggingface/transformers");
  return pipeline("feature-extraction", modelId, { dtype: "fp32" });
}
