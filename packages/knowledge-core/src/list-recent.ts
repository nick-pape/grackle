/**
 * List recently updated knowledge graph nodes.
 *
 * Returns the N most recently updated nodes with their immediate edges,
 * optionally scoped to a workspace. Used by the Knowledge Graph explorer
 * landing page.
 *
 * @module
 */

import type { Record as Neo4jRecord } from "neo4j-driver";
import { getSession } from "./client.js";
import { logger } from "./logger.js";
import { NODE_LABEL } from "./constants.js";
import { recordToNode, recordToEdge } from "./node-store.js";
import type { KnowledgeNode, KnowledgeEdge } from "./types.js";

/** Default number of recent nodes to return. */
const DEFAULT_LIMIT: number = 20;

/** Result of listing recent nodes. */
export interface RecentNodesResult {
  /** The most recently updated nodes. */
  nodes: KnowledgeNode[];
  /** All edges between the returned nodes. */
  edges: KnowledgeEdge[];
}

/**
 * List the most recently updated knowledge graph nodes.
 *
 * @param limit - Maximum number of nodes to return (default 20).
 * @param workspaceId - Optional workspace filter.
 * @returns Recent nodes and edges between them.
 */
export async function listRecentNodes(
  limit?: number,
  workspaceId?: string,
): Promise<RecentNodesResult> {
  const resolvedLimit: number = Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT));

  const filters: string[] = [];
  if (workspaceId !== undefined) {
    filters.push("n.workspaceId = $workspaceId");
  }

  const whereClause: string = filters.length > 0
    ? `WHERE ${filters.join(" AND ")}`
    : "";

  // Fetch recent nodes, then find edges between them
  const cypher: string = `
    MATCH (n:${NODE_LABEL})
    ${whereClause}
    WITH n ORDER BY n.updatedAt DESC LIMIT ${resolvedLimit}
    WITH collect(n) AS nodes
    UNWIND nodes AS n
    OPTIONAL MATCH (n)-[r]-(m:${NODE_LABEL})
    WHERE m IN nodes
    RETURN n,
      collect(DISTINCT {
        fromId: CASE WHEN startNode(r) = n THEN n.id ELSE m.id END,
        toId: CASE WHEN endNode(r) = n THEN n.id ELSE m.id END,
        type: type(r),
        metadata: r.metadata,
        createdAt: r.createdAt
      }) AS edges`;

  const params: Record<string, unknown> = {
    ...(workspaceId !== undefined ? { workspaceId } : {}),
  };

  const session = getSession();
  try {
    const result = await session.run(cypher, params);

    const nodeMap = new Map<string, KnowledgeNode>();
    const edgeSet = new Set<string>();
    const edges: KnowledgeEdge[] = [];

    for (const record of result.records as Neo4jRecord[]) {
      const neo4jNode = record.get("n") as { properties: Record<string, unknown> };
      const node: KnowledgeNode = recordToNode(neo4jNode.properties);
      nodeMap.set(node.id, node);

      const rawEdges: Record<string, unknown>[] =
        record.get("edges") as Record<string, unknown>[];
      for (const raw of rawEdges) {
        if (raw.fromId === null || raw.toId === null) {
          continue;
        }
        const edge: KnowledgeEdge = recordToEdge(raw);
        const key: string = `${edge.fromId}:${edge.toId}:${edge.type}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push(edge);
        }
      }
    }

    logger.debug(
      { nodes: nodeMap.size, edges: edges.length, limit: resolvedLimit },
      "Listed recent knowledge nodes",
    );

    return { nodes: [...nodeMap.values()], edges };
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after listRecentNodes");
    }
  }
}
