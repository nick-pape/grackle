/**
 * Knowledge graph subsystem for Grackle.
 *
 * Provides pluggable text embedding, content chunking, an ingestion
 * pipeline, and structured knowledge storage and retrieval via Neo4j,
 * so that agents can share and reuse contextual information across sessions.
 *
 * @packageDocumentation
 */

export { openNeo4j, closeNeo4j, healthCheck, getSession, getDriver } from "./client.js";
export type { Neo4jClientConfig } from "./client.js";
export { initSchema, SCHEMA_STATEMENTS } from "./schema.js";
export * from "./types.js";
export {
  DEFAULT_NEO4J_URL,
  DEFAULT_NEO4J_USER,
  DEFAULT_NEO4J_DATABASE,
  NEO4J_MAX_POOL_SIZE,
  NEO4J_CONNECTION_ACQUISITION_TIMEOUT,
  NODE_LABEL,
  VECTOR_INDEX_NAME,
  EMBEDDING_DIMENSIONS,
  VECTOR_SIMILARITY_FUNCTION,
} from "./constants.js";
export type { Embedder, EmbedderOptions, EmbeddingResult } from "./embedder.js";
export { createLocalEmbedder } from "./local-embedder.js";
export type { Chunk, Chunker } from "./chunker.js";
export { createPassThroughChunker } from "./pass-through-chunker.js";
export type { EmbeddedChunk } from "./ingest.js";
export { ingest } from "./ingest.js";
export type { TranscriptChunkerOptions } from "./transcript-chunker.js";
export { createTranscriptChunker } from "./transcript-chunker.js";
