/**
 * Edge CRUD operations for the knowledge graph.
 *
 * Provides create and remove operations for typed relationships between
 * {@link KnowledgeNode} instances, backed by Neo4j.
 *
 * @module
 */

import { getSession } from "./client.js";
import { logger } from "./logger.js";
import { NODE_LABEL } from "./constants.js";
import { EDGE_TYPE, type EdgeType, type KnowledgeEdge } from "./types.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Known edge type values for runtime validation. */
const VALID_EDGE_TYPES: ReadonlySet<string> = new Set(Object.values(EDGE_TYPE));

/**
 * Assert that a string is a valid {@link EdgeType}.
 *
 * @throws If the value is not a known edge type.
 */
function assertValidEdgeType(type: string): asserts type is EdgeType {
  if (!VALID_EDGE_TYPES.has(type)) {
    throw new Error(
      `Invalid edge type: "${type}". Must be one of: ${[...VALID_EDGE_TYPES].join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Cypher builders
// ---------------------------------------------------------------------------

/**
 * Build the Cypher query for creating an edge of a given type.
 *
 * Relationship types cannot be parameterized in Cypher, so the type is
 * interpolated directly. This is safe because {@link assertValidEdgeType}
 * ensures the value comes from the closed {@link EdgeType} union.
 */
function buildCreateEdgeCypher(edgeType: EdgeType): string {
  return [
    `MATCH (a:${NODE_LABEL} {id: $fromId}), (b:${NODE_LABEL} {id: $toId})`,
    `CREATE (a)-[r:${edgeType} {metadata: $metadata, createdAt: $createdAt}]->(b)`,
    `RETURN a.id AS fromId, b.id AS toId, type(r) AS type, r.metadata AS metadata, r.createdAt AS createdAt`,
  ].join("\n");
}

/**
 * Build the Cypher query for removing an edge of a given type.
 */
function buildRemoveEdgeCypher(edgeType: EdgeType): string {
  return [
    `MATCH (a:${NODE_LABEL} {id: $fromId})-[r:${edgeType}]->(b:${NODE_LABEL} {id: $toId})`,
    `DELETE r`,
    `RETURN count(r) AS deleted`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a typed edge between two nodes.
 *
 * @param fromId - Source node ID.
 * @param toId - Target node ID.
 * @param type - Relationship type (must be a valid {@link EdgeType}).
 * @param metadata - Optional metadata to attach to the edge.
 * @returns The created edge.
 * @throws If either node does not exist.
 * @throws If the edge type is invalid.
 */
export async function createEdge(
  fromId: string,
  toId: string,
  type: EdgeType,
  metadata?: Record<string, unknown>,
): Promise<KnowledgeEdge> {
  assertValidEdgeType(type);

  const createdAt = new Date().toISOString();
  const metadataStr: string | null = metadata !== undefined ? JSON.stringify(metadata) : null;

  const session = getSession();
  try {
    const result = await session.run(buildCreateEdgeCypher(type), {
      fromId,
      toId,
      metadata: metadataStr,
      createdAt,
    });

    if (result.records.length === 0) {
      throw new Error(
        `Cannot create edge: one or both nodes not found (fromId=${fromId}, toId=${toId})`,
      );
    }

    const record = result.records[0];

    let parsedMetadata: Record<string, unknown> | undefined;
    const rawMetadata = record.get("metadata") as string | null;
    if (rawMetadata !== null) {
      try {
        parsedMetadata = JSON.parse(rawMetadata) as Record<string, unknown>;
      } catch {
        parsedMetadata = undefined;
      }
    }

    logger.debug({ fromId, toId, type }, "Created edge");

    return {
      fromId: record.get("fromId") as string,
      toId: record.get("toId") as string,
      type: record.get("type") as EdgeType,
      metadata: parsedMetadata,
      createdAt: record.get("createdAt") as string,
    };
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after createEdge");
    }
  }
}

/**
 * Remove an edge between two nodes.
 *
 * @param fromId - Source node ID.
 * @param toId - Target node ID.
 * @param type - Relationship type to remove.
 * @returns `true` if an edge was removed, `false` if no matching edge existed.
 * @throws If the edge type is invalid.
 */
export async function removeEdge(
  fromId: string,
  toId: string,
  type: EdgeType,
): Promise<boolean> {
  assertValidEdgeType(type);

  const session = getSession();
  try {
    const result = await session.run(buildRemoveEdgeCypher(type), {
      fromId,
      toId,
    });

    const deleted = result.records[0]?.get("deleted") as number;
    if (deleted > 0) {
      logger.debug({ fromId, toId, type }, "Removed edge");
    }
    return deleted > 0;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after removeEdge");
    }
  }
}
