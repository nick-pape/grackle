/**
 * Pluggable embedder interface for converting text into vector embeddings.
 *
 * @module
 */

/** A single embedding result pairing input text with its vector. */
export interface EmbeddingResult {
  /** The input text that was embedded. */
  text: string;
  /** The embedding vector (array of floats). */
  vector: number[];
}

/** Configuration for creating an {@link Embedder}. */
export interface EmbedderOptions {
  /** HuggingFace model ID (e.g., `"Xenova/all-MiniLM-L6-v2"`). */
  modelId?: string;
  /** Expected embedding dimensions. Used for validation when set. */
  dimensions?: number;
}

/** Converts text into embedding vectors for semantic search and similarity. */
export interface Embedder {
  /** Embed a single text string. */
  embed(text: string): Promise<EmbeddingResult>;
  /** Embed multiple texts in batch. */
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
  /** The dimensionality of vectors produced by this embedder. */
  readonly dimensions: number;
}
