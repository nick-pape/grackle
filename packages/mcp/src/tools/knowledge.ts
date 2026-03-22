/**
 * MCP tools for the Grackle knowledge graph.
 *
 * Exposes high-level operations (search, retrieve, create) to agents.
 * All embedding, graph storage, and traversal details are handled
 * internally — agents interact with clean Grackle concepts.
 *
 * @module
 */

import type { Client } from "@connectrpc/connect";
import { grackle } from "@grackle-ai/common";
import { z } from "zod";
import type { AuthContext } from "../auth-context.js";
import {
  knowledgeSearch,
  getNode,
  createNativeNode,
  createEdge,
  expandNode,
  expandResults,
  NATIVE_CATEGORY,
  EDGE_TYPE,
  type Embedder,
  type EdgeType,
  type SearchResult,
  type KnowledgeNode,
  type KnowledgeEdge,
  type ExpansionResult,
} from "@grackle-ai/knowledge";
import type { ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";
import { logger } from "@grackle-ai/knowledge";

// ---------------------------------------------------------------------------
// Embedder accessor — set by the server at startup
// ---------------------------------------------------------------------------

/** Module-level embedder instance, initialized by the server. */
let embedder: Embedder | undefined;

/**
 * Set the shared embedder instance for knowledge tools.
 *
 * Called once by the server at startup (before MCP serves requests).
 * Pass `undefined` to clear the embedder (e.g., for testing).
 */
export function setKnowledgeEmbedder(e: Embedder | undefined): void {
  embedder = e;
}

/** Get the shared embedder, throwing if not initialized. */
function requireEmbedder(): Embedder {
  if (!embedder) {
    throw new Error(
      "Knowledge graph not available. The embedder has not been initialized.",
    );
  }
  return embedder;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed search results. */
const MAX_SEARCH_LIMIT: number = 50;

/** Maximum allowed expansion depth. */
const MAX_EXPAND_DEPTH: number = 5;

// ---------------------------------------------------------------------------
// Response formatting — hide internal details from agents
// ---------------------------------------------------------------------------

/** Format a node for agent consumption. */
function formatNode(node: KnowledgeNode): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: node.id,
    kind: node.kind,
    workspaceId: node.workspaceId,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };

  if (node.kind === "reference") {
    base.sourceType = node.sourceType;
    base.sourceId = node.sourceId;
    base.label = node.label;
  } else {
    base.category = node.category;
    base.title = node.title;
    base.content = node.content;
    base.tags = node.tags;
  }

  return base;
}

/** Format an edge for agent consumption. */
function formatEdge(edge: KnowledgeEdge): Record<string, unknown> {
  return {
    fromId: edge.fromId,
    toId: edge.toId,
    type: edge.type,
    ...(edge.metadata !== undefined ? { metadata: edge.metadata } : {}),
  };
}

/** Format a search result for agent consumption. */
function formatSearchResult(result: SearchResult): Record<string, unknown> {
  return {
    score: Math.round(result.score * 1000) / 1000,
    node: formatNode(result.node),
    edges: result.edges.map(formatEdge),
  };
}

/** Clamp a numeric input to a safe integer range. */
function clampInt(value: number | undefined, min: number, max: number, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/** Knowledge graph MCP tools. */
export const knowledgeTools: ToolDefinition[] = [
  {
    name: "knowledge_search",
    group: "knowledge",
    description:
      "Search the knowledge graph using natural language. Returns relevant nodes " +
      "(decisions, insights, task references, findings) ranked by semantic similarity.",
    inputSchema: z.object({
      query: z.string().describe("Natural language search query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_SEARCH_LIMIT)
        .optional()
        .describe(`Maximum number of results to return (default 10, max ${MAX_SEARCH_LIMIT})`),
      workspaceId: z
        .string()
        .optional()
        .describe("Filter results to a specific workspace"),
      expand: z
        .boolean()
        .optional()
        .describe(
          "If true, also return nodes connected to the search results (default false)",
        ),
      expandDepth: z
        .number()
        .int()
        .min(1)
        .max(MAX_EXPAND_DEPTH)
        .optional()
        .describe(`How many hops to traverse when expanding (default 1, max ${MAX_EXPAND_DEPTH})`),
    }),
    rpcMethod: "knowledgeSearch",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>) {
      const {
        query,
        limit,
        workspaceId,
        expand,
        expandDepth,
      } = args as {
        query: string;
        limit?: number;
        workspaceId?: string;
        expand?: boolean;
        expandDepth?: number;
      };

      try {
        const safeLimit: number = clampInt(limit, 1, MAX_SEARCH_LIMIT, 10);
        const results: SearchResult[] = await knowledgeSearch(
          query,
          requireEmbedder(),
          { limit: safeLimit, workspaceId },
        );

        const formattedResults = results.map(formatSearchResult);

        let neighbors: Record<string, unknown>[] | undefined;
        let neighborEdges: Record<string, unknown>[] | undefined;
        if (expand && results.length > 0) {
          const safeDepth: number = clampInt(expandDepth, 1, MAX_EXPAND_DEPTH, 1);
          const expansion: ExpansionResult = await expandResults(results, {
            depth: safeDepth,
          });
          neighbors = expansion.nodes.map(formatNode);
          neighborEdges = expansion.edges.map(formatEdge);
        }

        return jsonResult({
          results: formattedResults,
          ...(neighbors !== undefined ? { neighbors, neighborEdges } : {}),
        });
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error:
                    error instanceof Error
                      ? error.message
                      : "Knowledge search failed",
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: "knowledge_get_node",
    group: "knowledge",
    description:
      "Retrieve a specific node from the knowledge graph by its ID, " +
      "including all edges connecting it to other nodes.",
    inputSchema: z.object({
      id: z.string().describe("The node ID to retrieve"),
      expand: z
        .boolean()
        .optional()
        .describe(
          "If true, also return neighbor nodes within expandDepth hops (default false)",
        ),
      expandDepth: z
        .number()
        .int()
        .min(1)
        .max(MAX_EXPAND_DEPTH)
        .optional()
        .describe(`How many hops to traverse when expanding (default 1, max ${MAX_EXPAND_DEPTH})`),
    }),
    rpcMethod: "knowledgeGetNode",
    mutating: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>) {
      const { id, expand, expandDepth } = args as {
        id: string;
        expand?: boolean;
        expandDepth?: number;
      };

      try {
        const result = await getNode(id);

        if (!result) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { error: `Node not found: ${id}` },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        const response: Record<string, unknown> = {
          node: formatNode(result.node),
          edges: result.edges.map(formatEdge),
        };

        if (expand) {
          const safeDepth: number = clampInt(expandDepth, 1, MAX_EXPAND_DEPTH, 1);
          const expansion: ExpansionResult = await expandNode(id, {
            depth: safeDepth,
          });
          response.neighbors = expansion.nodes.map(formatNode);
          response.neighborEdges = expansion.edges.map(formatEdge);
        }

        return jsonResult(response);
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error:
                    error instanceof Error
                      ? error.message
                      : "Failed to retrieve node",
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  },

  {
    name: "knowledge_create_node",
    group: "knowledge",
    description:
      "Create a new knowledge entry (decision, insight, concept, or snippet). " +
      "The content is automatically embedded for future semantic search. " +
      "Optionally link it to existing nodes.",
    inputSchema: z.object({
      title: z.string().describe("Title or summary of the knowledge entry"),
      content: z
        .string()
        .describe("Full content to store and embed for search"),
      category: z
        .string()
        .optional()
        .describe(
          "Category: decision, insight, concept, snippet (default: insight)",
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for categorization"),
      workspaceId: z
        .string()
        .optional()
        .describe("Workspace to scope this entry to"),
      edges: z
        .array(
          z.object({
            toId: z.string().describe("ID of the node to link to"),
            type: z
              .enum([
                EDGE_TYPE.RELATES_TO,
                EDGE_TYPE.DEPENDS_ON,
                EDGE_TYPE.DERIVED_FROM,
                EDGE_TYPE.MENTIONS,
                EDGE_TYPE.PART_OF,
              ])
              .describe(
                "Relationship type: RELATES_TO, DEPENDS_ON, DERIVED_FROM, MENTIONS, PART_OF",
              ),
          }),
        )
        .optional()
        .describe("Edges to create from this node to existing nodes"),
    }),
    rpcMethod: "knowledgeCreateNode",
    mutating: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(args: Record<string, unknown>, _client: Client<typeof grackle.Grackle>, authContext?: AuthContext) {
      const {
        title,
        content,
        category,
        tags,
        workspaceId,
        edges,
      } = args as {
        title: string;
        content: string;
        category?: string;
        tags?: string[];
        workspaceId?: string;
        edges?: Array<{ toId: string; type: EdgeType }>;
      };

      try {
        const emb = requireEmbedder();
        const { vector } = await emb.embed(`${title} ${content}`);

        // For scoped callers, always use the auth context workspace.
        // For full-access callers, use the provided workspace or empty.
        const resolvedWorkspaceId: string =
          authContext?.type === "scoped"
            ? authContext.workspaceId ?? ""
            : workspaceId ?? "";

        const nodeId: string = await createNativeNode({
          category: category ?? NATIVE_CATEGORY.INSIGHT,
          title,
          content,
          tags: tags ?? [],
          embedding: vector,
          workspaceId: resolvedWorkspaceId,
        });

        // Create edges if requested
        const createdEdges: Array<Record<string, unknown>> = [];
        if (edges) {
          for (const edge of edges) {
            try {
              await createEdge(nodeId, edge.toId, edge.type);
              createdEdges.push({ toId: edge.toId, type: edge.type });
            } catch (edgeError) {
              logger.warn(
                { nodeId, toId: edge.toId, type: edge.type, err: edgeError },
                "Failed to create edge for knowledge node",
              );
              createdEdges.push({
                toId: edge.toId,
                type: edge.type,
                error:
                  edgeError instanceof Error
                    ? edgeError.message
                    : "Failed to create edge",
              });
            }
          }
        }

        return jsonResult({
          id: nodeId,
          title,
          category: category ?? NATIVE_CATEGORY.INSIGHT,
          ...(createdEdges.length > 0 ? { edges: createdEdges } : {}),
        });
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error:
                    error instanceof Error
                      ? error.message
                      : "Failed to create knowledge entry",
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  },
];
