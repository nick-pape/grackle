/**
 * Generic knowledge graph SDK on top of Neo4j.
 *
 * Provides pluggable text embedding, content chunking, an ingestion
 * pipeline, node/edge CRUD, semantic search, and graph traversal.
 * Domain-agnostic — consumers define their own source types and categories.
 *
 * @packageDocumentation
 */

export { openNeo4j, closeNeo4j, healthCheck, getSession, getDriver } from "./client.js";
export type { Neo4jClientConfig } from "./client.js";
export { initSchema, buildSchemaStatements, SCHEMA_STATEMENTS } from "./schema.js";
export { logger } from "./logger.js";
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
export {
  createReferenceNode,
  createNativeNode,
  getNode,
  deleteNode,
  updateNode,
  recordToNode,
  recordToEdge,
} from "./node-store.js";
export type {
  CreateReferenceNodeInput,
  CreateNativeNodeInput,
  UpdateReferenceNodeInput,
  UpdateNativeNodeInput,
  UpdateNodeInput,
  NodeWithEdges,
} from "./node-store.js";
export { createEdge, removeEdge } from "./edge-store.js";
export type { SearchOptions, SearchResult } from "./search.js";
export { knowledgeSearch } from "./search.js";
export type { ExpandOptions, ExpansionResult } from "./expand.js";
export { expandNode, expandResults } from "./expand.js";
export type { RecentNodesResult } from "./list-recent.js";
export { listRecentNodes } from "./list-recent.js";
