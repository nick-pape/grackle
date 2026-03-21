/**
 * Ingestion pipeline that chunks content and embeds each chunk.
 *
 * @module
 */

import type { Chunk, Chunker } from "./chunker.js";
import type { Embedder } from "./embedder.js";

/** A chunk with its embedding vector attached. */
export interface EmbeddedChunk extends Chunk {
  /** The embedding vector for this chunk's text. */
  vector: number[];
}

/**
 * Chunk content and embed each chunk in a single pipeline.
 *
 * @param content - The raw text content to ingest.
 * @param chunker - Splits the content into chunks.
 * @param embedder - Produces embedding vectors for each chunk.
 * @param metadata - Optional metadata passed through to the chunker.
 * @returns An array of chunks with embedding vectors attached.
 */
export async function ingest(
  content: string,
  chunker: Chunker,
  embedder: Embedder,
  metadata?: Record<string, unknown>,
): Promise<EmbeddedChunk[]> {
  const chunks: Chunk[] = chunker.chunk(content, metadata);

  if (chunks.length === 0) {
    return [];
  }

  const texts: string[] = chunks.map((c) => c.text);
  const embeddings = await embedder.embedBatch(texts);

  return chunks.map((chunk, i) => ({
    ...chunk,
    vector: embeddings[i].vector,
  }));
}
