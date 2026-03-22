/**
 * Vector-based semantic search across the knowledge graph.
 *
 * Embeds a text query, runs k-NN vector search against Neo4j's vector index,
 * and returns ranked results with similarity scores and immediate edges.
 *
 * @module
 */

import type { Record as Neo4jRecord } from "neo4j-driver";
import { getSession } from "./client.js";
import { logger } from "./logger.js";
import { NODE_LABEL, VECTOR_INDEX_NAME } from "./constants.js";
import { recordToNode, recordToEdge } from "./node-store.js";
import type { Embedder } from "./embedder.js";
import type { KnowledgeNode, KnowledgeEdge, NodeKind } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for knowledge graph search. */
export interface SearchOptions {
  /** Max results to return (default 10). */
  limit?: number;
  /** Filter to specific node kinds (reference, native, or both). */
  nodeKinds?: NodeKind[];
  /** Minimum similarity score threshold (default 0). Passed directly to the Cypher WHERE clause. */
  minScore?: number;
  /** Filter to a specific workspace. */
  workspaceId?: string;
}

/** A search result: a node with its similarity score and immediate edges. */
export interface SearchResult {
  /** The matched node. */
  node: KnowledgeNode;
  /** Cosine similarity score (0-1). */
  score: number;
  /** Edges connected to this node. */
  edges: KnowledgeEdge[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of results to return. */
const DEFAULT_LIMIT: number = 10;

/** Default minimum similarity score. */
const DEFAULT_MIN_SCORE: number = 0;

// ---------------------------------------------------------------------------
// Cypher
// ---------------------------------------------------------------------------

/**
 * Build the Cypher query for vector search with optional filters.
 *
 * Neo4j's `db.index.vector.queryNodes` does not support WHERE clauses
 * directly, so we apply post-filters on the yielded results.
 */
function buildSearchCypher(options: {
  nodeKinds?: NodeKind[];
  workspaceId?: string;
}): string {
  const filters: string[] = ["score >= $minScore"];

  if (options.nodeKinds && options.nodeKinds.length > 0) {
    filters.push("node.kind IN $nodeKinds");
  }
  if (options.workspaceId !== undefined) {
    filters.push("node.workspaceId = $workspaceId");
  }

  const whereClause: string = filters.length > 0
    ? `WHERE ${filters.join(" AND ")}`
    : "";

  return `
    CALL db.index.vector.queryNodes($indexName, $candidateLimit, $queryVector)
    YIELD node, score
    ${whereClause}
    WITH node, score
    ORDER BY score DESC
    LIMIT $limit
    OPTIONAL MATCH (node)-[r]-(m:${NODE_LABEL})
    RETURN node, score,
      collect(DISTINCT {
        fromId: CASE WHEN startNode(r) = node THEN node.id ELSE m.id END,
        toId: CASE WHEN endNode(r) = node THEN node.id ELSE m.id END,
        type: type(r),
        metadata: r.metadata,
        createdAt: r.createdAt
      }) AS edges`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search the knowledge graph by semantic similarity.
 *
 * Embeds the query text, runs k-NN vector search in Neo4j, and returns
 * ranked results with similarity scores and immediate edges.
 *
 * @param query - The text to search for.
 * @param embedder - Produces the query embedding vector.
 * @param options - Optional search filters and limits.
 * @returns Ranked search results, highest similarity first.
 */
export async function knowledgeSearch(
  query: string,
  embedder: Embedder,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const limit: number = options?.limit ?? DEFAULT_LIMIT;
  const minScore: number = options?.minScore ?? DEFAULT_MIN_SCORE;

  // Embed the query
  const { vector: queryVector } = await embedder.embed(query);

  // Over-fetch when filtering so we still get enough results after post-filter
  const hasFilters: boolean = !!(options?.nodeKinds?.length || options?.workspaceId !== undefined);
  const candidateLimit: number = hasFilters ? limit * 3 : limit;

  const cypher: string = buildSearchCypher({
    nodeKinds: options?.nodeKinds,
    workspaceId: options?.workspaceId,
  });

  const params: Record<string, unknown> = {
    indexName: VECTOR_INDEX_NAME,
    queryVector,
    limit,
    candidateLimit,
    minScore,
    ...(options?.nodeKinds ? { nodeKinds: options.nodeKinds } : {}),
    ...(options?.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
  };

  const session = getSession();
  try {
    const result = await session.run(cypher, params);

    const searchResults: SearchResult[] = result.records.map((record: Neo4jRecord) => {
      const neo4jNode = record.get("node") as { properties: Record<string, unknown> };
      const nodeProps: Record<string, unknown> = neo4jNode.properties;
      const score: number = record.get("score") as number;
      const rawEdges: Record<string, unknown>[] =
        record.get("edges") as Record<string, unknown>[];

      // Filter out null edges (from OPTIONAL MATCH with no relationships)
      const edges: KnowledgeEdge[] = rawEdges
        .filter((e) => e.fromId !== null && e.toId !== null)
        .map(recordToEdge);

      return {
        node: recordToNode(nodeProps),
        score,
        edges,
      };
    });

    logger.debug(
      { query: query.substring(0, 50), results: searchResults.length, limit },
      "Knowledge search completed",
    );

    return searchResults;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after knowledgeSearch");
    }
  }
}
