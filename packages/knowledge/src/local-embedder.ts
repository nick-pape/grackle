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
 * When using the default model, dimensions are known upfront (384). When using
 * a custom model without specifying dimensions, the value is inferred from the
 * first embedding result.
 *
 * @param options - Optional configuration for model selection and dimensions.
 * @returns An {@link Embedder} instance backed by local ONNX inference.
 */
export function createLocalEmbedder(options?: EmbedderOptions): Embedder {
  const modelId: string = options?.modelId ?? DEFAULT_MODEL_ID;
  let resolvedDimensions: number =
    options?.dimensions ?? (modelId === DEFAULT_MODEL_ID ? DEFAULT_DIMENSIONS : 0);

  let pipelinePromise: Promise<FeatureExtractionPipeline> | undefined;

  /**
   * Lazily initialise the feature-extraction pipeline.
   * Concurrent calls share the same promise so the model is loaded once.
   * If initialisation fails, the cached promise is cleared so future calls can retry.
   */
  function getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!pipelinePromise) {
      pipelinePromise = initPipeline(modelId).catch((error: unknown) => {
        pipelinePromise = undefined;
        throw error;
      });
    }
    return pipelinePromise;
  }

  /** Run inference for a single text and return its vector. */
  async function embedOne(pipe: FeatureExtractionPipeline, text: string): Promise<EmbeddingResult> {
    const output = await pipe(text, { pooling: "mean", normalize: true });
    const vector: number[] = Array.from(output.data as Float32Array);

    if (resolvedDimensions === 0) {
      resolvedDimensions = vector.length;
    } else if (vector.length !== resolvedDimensions) {
      throw new Error(
        `Dimension mismatch: expected ${resolvedDimensions}, got ${vector.length}. ` +
        `Check that the model "${modelId}" produces ${resolvedDimensions}-dim vectors.`
      );
    }

    return { text, vector };
  }

  return {
    get dimensions(): number {
      return resolvedDimensions;
    },

    async embed(text: string): Promise<EmbeddingResult> {
      const pipe = await getPipeline();
      return embedOne(pipe, text);
    },

    async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
      if (texts.length === 0) {
        return [];
      }
      const pipe = await getPipeline();
      const results: EmbeddingResult[] = [];
      for (const text of texts) {
        results.push(await embedOne(pipe, text));
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
