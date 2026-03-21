/**
 * Neo4j schema initialization — constraints, indexes, and vector index.
 *
 * All statements use `IF NOT EXISTS` for idempotency and are safe to run
 * on every application startup.
 *
 * @module
 */

import { getSession } from "./client.js";
import { logger } from "./logger.js";
import {
  NODE_LABEL,
  VECTOR_INDEX_NAME,
  EMBEDDING_DIMENSIONS,
  VECTOR_SIMILARITY_FUNCTION,
} from "./constants.js";

/**
 * Cypher statements for schema initialization.
 *
 * Exported so tests can verify the exact statements that will be executed.
 */
export const SCHEMA_STATEMENTS: Record<string, string> = {
  /** Uniqueness constraint on node ID. */
  UNIQUE_NODE_ID: `CREATE CONSTRAINT knowledge_node_id_unique IF NOT EXISTS
    FOR (n:${NODE_LABEL}) REQUIRE n.id IS UNIQUE`,

  /** Index on the kind property for efficient filtering. */
  INDEX_KIND: `CREATE INDEX knowledge_node_kind IF NOT EXISTS
    FOR (n:${NODE_LABEL}) ON (n.kind)`,

  /** Index on workspaceId for scoped queries. */
  INDEX_WORKSPACE: `CREATE INDEX knowledge_node_workspace IF NOT EXISTS
    FOR (n:${NODE_LABEL}) ON (n.workspaceId)`,

  /** Composite index for reference node lookups by source. */
  INDEX_SOURCE: `CREATE INDEX knowledge_node_source IF NOT EXISTS
    FOR (n:${NODE_LABEL}) ON (n.sourceType, n.sourceId)`,

  /** Vector index for embedding similarity search. */
  VECTOR_INDEX: [
    `CREATE VECTOR INDEX ${VECTOR_INDEX_NAME} IF NOT EXISTS`,
    `FOR (n:${NODE_LABEL}) ON (n.embedding)`,
    `OPTIONS {`,
    `  indexConfig: {`,
    `    \`vector.dimensions\`: ${EMBEDDING_DIMENSIONS},`,
    `    \`vector.similarity_function\`: '${VECTOR_SIMILARITY_FUNCTION}'`,
    `  }`,
    `}`,
  ].join("\n"),
};

/**
 * Initialize the Neo4j schema: constraints, property indexes, and the
 * vector index.
 *
 * All statements are idempotent (`IF NOT EXISTS`). Call once at startup
 * after {@link openNeo4j}.
 */
export async function initSchema(): Promise<void> {
  const session = getSession();
  try {
    for (const [name, cypher] of Object.entries(SCHEMA_STATEMENTS)) {
      logger.debug({ statement: name }, "Running schema statement");
      await session.run(cypher);
    }
    logger.info("Knowledge graph schema initialized");
  } finally {
    await session.close();
  }
}
