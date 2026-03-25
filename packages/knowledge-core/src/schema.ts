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
 * Build the Cypher statements for schema initialization.
 *
 * @param dimensions - Dimensionality of the vector index. Defaults to
 *   {@link EMBEDDING_DIMENSIONS} (1536) but callers should pass the actual
 *   embedder dimensions so the index matches the vectors being stored.
 */
export function buildSchemaStatements(dimensions: number = EMBEDDING_DIMENSIONS): Record<string, string> {
  return {
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
      `    \`vector.dimensions\`: ${dimensions},`,
      `    \`vector.similarity_function\`: '${VECTOR_SIMILARITY_FUNCTION}'`,
      `  }`,
      `}`,
    ].join("\n"),
  };
}

/**
 * Static statements using the default dimensions.
 *
 * @deprecated Use {@link buildSchemaStatements} with the embedder's actual dimensions.
 */
export const SCHEMA_STATEMENTS: Record<string, string> = buildSchemaStatements();

/**
 * Initialize the Neo4j schema: constraints, property indexes, and the
 * vector index.
 *
 * All statements are idempotent (`IF NOT EXISTS`). Call once at startup
 * after {@link openNeo4j}.
 *
 * @param dimensions - Dimensionality of the vector index. Should match
 *   the embedder being used (e.g., 384 for the default local embedder).
 *   Defaults to {@link EMBEDDING_DIMENSIONS} (1536).
 */
export async function initSchema(dimensions?: number): Promise<void> {
  const statements = dimensions !== undefined
    ? buildSchemaStatements(dimensions)
    : SCHEMA_STATEMENTS;
  const session = getSession();
  try {
    for (const [name, cypher] of Object.entries(statements)) {
      logger.debug({ statement: name }, "Running schema statement");
      try {
        await session.run(cypher);
      } catch (error) {
        // Neo4j CE throws EquivalentSchemaRuleAlreadyExists even with IF NOT EXISTS
        // when an equivalent index exists with a different internal name. This is
        // safe to ignore — the schema is already in the desired state.
        const code = (error as { code?: string }).code ?? "";
        if (code.includes("EquivalentSchemaRuleAlreadyExists")) {
          logger.debug({ statement: name }, "Schema element already exists, skipping");
          continue;
        }
        logger.error({ err: error, statement: name }, "Schema statement failed");
        throw new Error(
          `Schema statement "${name}" failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }
    logger.info("Knowledge graph schema initialized");
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close Neo4j session after schema initialization");
    }
  }
}
