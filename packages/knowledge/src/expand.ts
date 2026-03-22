/**
 * Graph expansion — traverse the knowledge graph from a starting node
 * to discover connected nodes within N hops.
 *
 * @module
 */

import type { Record as Neo4jRecord } from "neo4j-driver";
import { getSession } from "./client.js";
import { logger } from "./logger.js";
import { NODE_LABEL } from "./constants.js";
import { recordToNode, recordToEdge } from "./node-store.js";
import type { KnowledgeNode, KnowledgeEdge, EdgeType } from "./types.js";
import { EDGE_TYPE } from "./types.js";
import type { SearchResult } from "./search.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for graph expansion. */
export interface ExpandOptions {
  /** Max traversal depth (default 1). */
  depth?: number;
  /** Only follow edges of these types. If empty/undefined, follow all. */
  edgeTypes?: EdgeType[];
}

/** Result of a graph expansion: the subgraph reachable from the starting node(s). */
export interface ExpansionResult {
  /** All neighbor nodes found (deduplicated), excluding the start node(s). */
  nodes: KnowledgeNode[];
  /** All edges traversed. */
  edges: KnowledgeEdge[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default traversal depth. */
const DEFAULT_DEPTH: number = 1;

/** Known edge type values for runtime validation. */
const VALID_EDGE_TYPES: ReadonlySet<string> = new Set(Object.values(EDGE_TYPE));

// ---------------------------------------------------------------------------
// Cypher
// ---------------------------------------------------------------------------

/**
 * Build the Cypher query for variable-length path traversal.
 *
 * When edge types are specified, they are interpolated into the relationship
 * pattern (e.g., `[:RELATES_TO|DEPENDS_ON*1..2]`). This is safe because
 * values are validated against the closed {@link EdgeType} union.
 */
function buildExpandCypher(depth: number, edgeTypes?: EdgeType[]): string {
  // Neo4j requires integer literals for variable-length ranges — cannot parameterize.
  let relPattern: string;
  if (edgeTypes && edgeTypes.length > 0) {
    for (const t of edgeTypes) {
      if (!VALID_EDGE_TYPES.has(t)) {
        throw new Error(
          `Invalid edge type: "${t}". Must be one of: ${[...VALID_EDGE_TYPES].join(", ")}`,
        );
      }
    }
    relPattern = `[:${edgeTypes.join("|")}*1..${depth}]`;
  } else {
    relPattern = `[*1..${depth}]`;
  }

  return `
    MATCH path = (start:${NODE_LABEL} {id: $startId})-${relPattern}-(neighbor:${NODE_LABEL})
    WHERE neighbor.id <> $startId
    UNWIND relationships(path) AS rel
    WITH DISTINCT neighbor,
      collect(DISTINCT {
        fromId: startNode(rel).id,
        toId: endNode(rel).id,
        type: type(rel),
        metadata: rel.metadata,
        createdAt: rel.createdAt
      }) AS rels
    RETURN neighbor, rels`;
}

/**
 * Merge two expansion results, deduplicating nodes by ID and edges by
 * (fromId, toId, type) triple.
 */
function mergeResults(a: ExpansionResult, b: ExpansionResult): ExpansionResult {
  const nodeMap = new Map<string, KnowledgeNode>();
  for (const node of [...a.nodes, ...b.nodes]) {
    nodeMap.set(node.id, node);
  }

  const edgeSet = new Set<string>();
  const edges: KnowledgeEdge[] = [];
  for (const edge of [...a.edges, ...b.edges]) {
    const key: string = `${edge.fromId}:${edge.toId}:${edge.type}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push(edge);
    }
  }

  return { nodes: [...nodeMap.values()], edges };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Expand a single node: return its neighbors within N hops.
 *
 * @param nodeId - The starting node ID.
 * @param options - Traversal depth and optional edge type filter.
 * @returns Neighbor nodes and traversed edges (deduplicated).
 */
export async function expandNode(
  nodeId: string,
  options?: ExpandOptions,
): Promise<ExpansionResult> {
  const rawDepth: number = options?.depth ?? DEFAULT_DEPTH;
  const depth: number = Number.isFinite(rawDepth) ? Math.max(1, Math.floor(rawDepth)) : DEFAULT_DEPTH;
  const cypher: string = buildExpandCypher(depth, options?.edgeTypes);

  const session = getSession();
  try {
    const result = await session.run(cypher, { startId: nodeId });

    const nodeMap = new Map<string, KnowledgeNode>();
    const edgeSet = new Set<string>();
    const edges: KnowledgeEdge[] = [];

    for (const record of result.records as Neo4jRecord[]) {
      const neo4jNode = record.get("neighbor") as { properties: Record<string, unknown> };
      const node: KnowledgeNode = recordToNode(neo4jNode.properties);
      nodeMap.set(node.id, node);

      const rawEdges: Record<string, unknown>[] =
        record.get("rels") as Record<string, unknown>[];
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
      { startId: nodeId, depth, nodes: nodeMap.size, edges: edges.length },
      "Graph expansion completed",
    );

    return { nodes: [...nodeMap.values()], edges };
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      logger.warn({ err: closeError }, "Failed to close session after expandNode");
    }
  }
}

/**
 * Expand search results: return neighbors of all result nodes, deduplicated.
 *
 * Runs {@link expandNode} for each search result and merges the subgraphs,
 * excluding the original search result nodes from the neighbor list.
 *
 * @param results - Search results from {@link knowledgeSearch}.
 * @param options - Traversal depth and optional edge type filter.
 * @returns Combined neighbor nodes and edges from all start nodes.
 */
export async function expandResults(
  results: SearchResult[],
  options?: ExpandOptions,
): Promise<ExpansionResult> {
  if (results.length === 0) {
    return { nodes: [], edges: [] };
  }

  const startIds: Set<string> = new Set(results.map((r) => r.node.id));
  let merged: ExpansionResult = { nodes: [], edges: [] };

  for (const result of results) {
    const expansion: ExpansionResult = await expandNode(result.node.id, options);
    merged = mergeResults(merged, expansion);
  }

  // Exclude the original search result nodes from the neighbor list
  merged.nodes = merged.nodes.filter((n) => !startIds.has(n.id));

  return merged;
}
