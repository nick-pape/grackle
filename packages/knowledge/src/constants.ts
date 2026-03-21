/**
 * Constants for the Neo4j knowledge graph subsystem.
 *
 * @module
 */

/** Default Neo4j Bolt connection URL. */
export const DEFAULT_NEO4J_URL: string = "bolt://localhost:7687";

/** Default Neo4j username. */
export const DEFAULT_NEO4J_USER: string = "neo4j";

/** Default Neo4j password (development only; production should always override). */
export const DEFAULT_NEO4J_PASSWORD: string = "grackle-dev";

/** Default Neo4j database name. */
export const DEFAULT_NEO4J_DATABASE: string = "neo4j";

/** Neo4j node label applied to all knowledge graph nodes. */
export const NODE_LABEL: string = "KnowledgeNode";

/** Name of the vector index on knowledge node embeddings. */
export const VECTOR_INDEX_NAME: string = "knowledge_embedding_index";

/** Dimensionality of the embedding vectors (OpenAI text-embedding-3-small). */
export const EMBEDDING_DIMENSIONS: number = 1536;

/** Similarity function used by the vector index. */
export const VECTOR_SIMILARITY_FUNCTION: string = "cosine";
