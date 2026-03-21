/**
 * Knowledge graph subsystem for Grackle.
 *
 * Provides pluggable text embedding, content chunking, and an ingestion
 * pipeline so that agents can share and reuse contextual information
 * across sessions.
 *
 * @packageDocumentation
 */

export type { Embedder, EmbedderOptions, EmbeddingResult } from "./embedder.js";
export { createLocalEmbedder } from "./local-embedder.js";
export type { Chunk, Chunker } from "./chunker.js";
export { createPassThroughChunker } from "./pass-through-chunker.js";
export type { EmbeddedChunk } from "./ingest.js";
export { ingest } from "./ingest.js";
