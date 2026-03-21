/**
 * Knowledge graph subsystem for Grackle.
 *
 * Provides pluggable text embedding and (in future tickets) vector search
 * and graph traversal so that agents can share and reuse contextual
 * information across sessions.
 *
 * @packageDocumentation
 */

export type { Embedder, EmbedderOptions, EmbeddingResult } from "./embedder.js";
export { createLocalEmbedder } from "./local-embedder.js";
