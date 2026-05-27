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
export async function removeEdge(fromId: string, toId: string, type: EdgeType): Promise<boolean> {
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

/**
 * Build the Cypher query for idempotently upserting an edge of a given type.
 *
 * Relationship types cannot be parameterized; the type is interpolated after
 * {@link assertValidEdgeType} validation (same safety contract as create).
 */
function buildUpsertEdgeCypher(edgeType: EdgeType): string {
  return [
    `MATCH (a:${NODE_LABEL} {id: $fromId}), (b:${NODE_LABEL} {id: $toId})`,
    `MERGE (a)-[r:${edgeType}]->(b)`,
    `ON CREATE SET r.createdAt = $createdAt`,
    `SET r.metadata = $metadata`,
    `RETURN a.id AS fromId, b.id AS toId, type(r) AS type, r.metadata AS metadata, r.createdAt AS createdAt`,
  ].join("\n");
}

/**
 * Idempotently upsert a typed edge between two nodes (Neo4j `MERGE`).
 *
 * Repeated calls converge to a single relationship. `createdAt` is set only on
 * create; `metadata` is set every call. Used by derived-mirror projection (#1258).
 *
 * @throws If either node does not exist, or the edge type is invalid.
 */
export async function upsertEdge(
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
    const result = await session.run(buildUpsertEdgeCypher(type), {
      fromId,
      toId,
      metadata: metadataStr,
      createdAt,
    });

    if (result.records.length === 0) {
      throw new Error(
        `Cannot upsert edge: one or both nodes not found (fromId=${fromId}, toId=${toId})`,
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

    logger.debug({ fromId, toId, type }, "Upserted edge");

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
      logger.warn({ err: closeError }, "Failed to close session after upsertEdge");
    }
  }
}

/**
 * Remove all outgoing edges of the given types from a node.
 *
 * Used by derived-mirror projection to reconcile structural edges: before
 * re-adding the current edge set for an entity, stale edges (e.g. from a
 * reparented task or a changed foreign key) are cleared so the projection
 * stays a faithful mirror.
 *
 * @returns The number of edges removed.
 */
export async function removeOutgoingEdges(fromId: string, types: EdgeType[]): Promise<number> {
  for (const type of types) {
    assertValidEdgeType(type);
  }
  if (types.length === 0) {
    return 0;
  }

  const session = getSession();
  try {
    // Count via the query summary rather than RETURN-ing the deleted variable
    // (unambiguous; consistent with the other bulk-delete helpers).
    const result = await session.run(
      `MATCH (a:${NODE_LABEL} {id: $fromId})-[r]->(:${NODE_LABEL})
       WHERE type(r) IN $types
       DELETE r`,
      { fromId, types },
    );
    return result.summary.counters.updates().relationshipsDeleted;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after removeOutgoingEdges");
    }
  }
}
