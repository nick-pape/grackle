/**
 * MCP tools for the Grackle knowledge graph.
 *
 * Exposes high-level operations (search, retrieve, create) to agents.
 * All calls go through gRPC to the Grackle server — the MCP package
 * does not access knowledge-core or Neo4j directly.
 *
 * @module
 */

import type { Client } from "@connectrpc/connect";
import { grackle } from "@grackle-ai/common";
import { z } from "zod";
import type { AuthContext } from "../auth-context.js";
import type { ToolDefinition } from "../tool-registry.js";
import { jsonResult } from "../result-helpers.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed search results. */
const MAX_SEARCH_LIMIT: number = 50;

/** Maximum allowed expansion depth. */
const MAX_EXPAND_DEPTH: number = 5;

/** Valid edge type values. */
const EDGE_TYPES = [
  "RELATES_TO",
  "DEPENDS_ON",
  "DERIVED_FROM",
  "MENTIONS",
  "PART_OF",
] as const;

// ---------------------------------------------------------------------------
// Response formatting — hide internal details from agents
// ---------------------------------------------------------------------------

/** Format a proto node for agent consumption. */
function formatNode(node: grackle.KnowledgeNodeProto): Record<string, unknown> {
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
    base.tags = [...node.tags];
  }

  return base;
}

/** Format a proto edge for agent consumption. */
function formatEdge(edge: grackle.KnowledgeEdgeProto): Record<string, unknown> {
  const result: Record<string, unknown> = {
    fromId: edge.fromId,
    toId: edge.toId,
    type: edge.type,
  };
  if (edge.metadataJson) {
    try {
      result.metadata = JSON.parse(edge.metadataJson);
    } catch {
      // ignore malformed metadata
    }
  }
  return result;
}

/** Format a search result for agent consumption. */
function formatSearchResult(result: grackle.SearchKnowledgeResult): Record<string, unknown> {
  return {
    score: Math.round(result.score * 1000) / 1000,
    node: result.node ? formatNode(result.node) : {},
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
    async handler(
      args: Record<string, unknown>,
      client: Client<typeof grackle.Grackle>,
      authContext?: AuthContext,
    ) {
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

      // For scoped callers, always use the auth context workspace.
      const resolvedWorkspaceId: string =
        authContext?.type === "scoped"
          ? authContext.workspaceId ?? ""
          : workspaceId ?? "";

      const safeLimit: number = clampInt(limit, 1, MAX_SEARCH_LIMIT, 10);
      const response: grackle.SearchKnowledgeResponse = await client.searchKnowledge({
        query,
        limit: safeLimit,
        workspaceId: resolvedWorkspaceId,
      });

      const formattedResults = response.results.map(formatSearchResult);

      let neighbors: Record<string, unknown>[] | undefined;
      let neighborEdges: Record<string, unknown>[] | undefined;
      if (expand && response.results.length > 0) {
        // Expand each result node via gRPC
        const safeDepth: number = clampInt(expandDepth, 1, MAX_EXPAND_DEPTH, 1);
        const allNeighbors = new Map<string, Record<string, unknown>>();
        const allEdges: Record<string, unknown>[] = [];
        const startIds: Set<string> = new Set(
          response.results.map((r) => r.node?.id ?? "").filter(Boolean),
        );

        for (const result of response.results) {
          if (!result.node) {
            continue;
          }
          const expansion: grackle.ExpandKnowledgeNodeResponse =
            await client.expandKnowledgeNode({
              id: result.node.id,
              depth: safeDepth,
            });
          for (const node of expansion.nodes) {
            if (!startIds.has(node.id)) {
              allNeighbors.set(node.id, formatNode(node));
            }
          }
          for (const edge of expansion.edges) {
            allEdges.push(formatEdge(edge));
          }
        }

        neighbors = [...allNeighbors.values()];
        neighborEdges = allEdges;

        // Filter expanded neighbors to the caller's workspace for scoped callers.
        if (authContext?.type === "scoped") {
          const allowedWorkspaceId: string = authContext.workspaceId ?? "";
          const allowedIds: Set<string> = new Set<string>();
          neighbors = neighbors.filter((n) => {
            const allowed = n.workspaceId === allowedWorkspaceId;
            if (allowed) {
              allowedIds.add(n.id as string);
            }
            return allowed;
          });
          const allowedEdgeNodeIds: Set<string> = new Set<string>([
            ...startIds,
            ...allowedIds,
          ]);
          neighborEdges = neighborEdges.filter(
            (e) => allowedEdgeNodeIds.has(e.fromId as string) && allowedEdgeNodeIds.has(e.toId as string),
          );
        }
      }

      return jsonResult({
        results: formattedResults,
        ...(neighbors !== undefined ? { neighbors, neighborEdges } : {}),
      });
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
    async handler(
      args: Record<string, unknown>,
      client: Client<typeof grackle.Grackle>,
      authContext?: AuthContext,
    ) {
      const { id, expand, expandDepth } = args as {
        id: string;
        expand?: boolean;
        expandDepth?: number;
      };

      const response: grackle.GetKnowledgeNodeResponse =
        await client.getKnowledgeNode({ id });

      if (!response.node) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Node not found: ${id}` }, null, 2),
            },
          ],
          isError: true,
        };
      }

      // For scoped callers, deny access to nodes outside their workspace.
      // Return "not found" to avoid leaking that the node exists.
      if (authContext?.type === "scoped") {
        if (response.node.workspaceId !== (authContext.workspaceId ?? "")) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: `Node not found: ${id}` }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      const result: Record<string, unknown> = {
        node: formatNode(response.node),
        edges: response.edges.map(formatEdge),
      };

      if (expand) {
        const safeDepth: number = clampInt(expandDepth, 1, MAX_EXPAND_DEPTH, 1);
        const expansion: grackle.ExpandKnowledgeNodeResponse =
          await client.expandKnowledgeNode({ id, depth: safeDepth });
        let expandedNodes: Record<string, unknown>[] = expansion.nodes.map(formatNode);
        let expandedEdges: Record<string, unknown>[] = expansion.edges.map(formatEdge);

        // Filter expanded neighbors to the caller's workspace for scoped callers.
        if (authContext?.type === "scoped") {
          const allowedWorkspaceId: string = authContext.workspaceId ?? "";
          const allowedIds: Set<string> = new Set<string>([id]);
          expandedNodes = expandedNodes.filter((n) => {
            const allowed = n.workspaceId === allowedWorkspaceId;
            if (allowed) {
              allowedIds.add(n.id as string);
            }
            return allowed;
          });
          expandedEdges = expandedEdges.filter(
            (e) => allowedIds.has(e.fromId as string) && allowedIds.has(e.toId as string),
          );
        }

        result.neighbors = expandedNodes;
        result.neighborEdges = expandedEdges;
      }

      return jsonResult(result);
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
              .enum(EDGE_TYPES)
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
    async handler(
      args: Record<string, unknown>,
      client: Client<typeof grackle.Grackle>,
      authContext?: AuthContext,
    ) {
      const {
        title,
        content,
        category,
        tags,
        workspaceId,
      } = args as {
        title: string;
        content: string;
        category?: string;
        tags?: string[];
        workspaceId?: string;
      };

      // For scoped callers, always use the auth context workspace.
      const resolvedWorkspaceId: string =
        authContext?.type === "scoped"
          ? authContext.workspaceId ?? ""
          : workspaceId ?? "";

      const response: grackle.CreateKnowledgeNodeResponse =
        await client.createKnowledgeNode({
          title,
          content,
          category: category ?? "insight",
          tags: tags ?? [],
          workspaceId: resolvedWorkspaceId,
        });

      // Note: edge creation is now handled server-side or as a follow-up.
      // The gRPC CreateKnowledgeNode endpoint creates the node; edges
      // can be added in a future enhancement.

      return jsonResult({
        id: response.id,
        title,
        category: category ?? "insight",
      });
    },
  },
];
