/**
 * Data hook for the Knowledge Graph explorer.
 *
 * Sends WebSocket messages to the server and processes responses
 * to maintain a local graph state for rendering.
 *
 * @module
 */

import { useState, useCallback, useRef } from "react";
import { useGrackle } from "../context/GrackleContext.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A node in the force graph. */
export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  category?: string;
  sourceType?: string;
  sourceId?: string;
  content?: string;
  tags?: string[];
  workspaceId?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Node size (edge count). */
  val: number;
}

/** A link in the force graph. */
export interface GraphLink {
  source: string;
  target: string;
  type: string;
}

/** Full detail for a selected node. */
export interface NodeDetail {
  node: GraphNode;
  edges: Array<{ fromId: string; toId: string; type: string; metadata?: Record<string, unknown> }>;
}

/** Result returned by useKnowledge. */
export interface UseKnowledgeResult {
  graphData: { nodes: GraphNode[]; links: GraphLink[] };
  selectedNode: NodeDetail | null;
  loading: boolean;
  searchQuery: string;
  search(query: string): void;
  clearSearch(): void;
  selectNode(id: string): void;
  expandNode(id: string): void;
  loadRecent(workspaceId?: string): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a raw WS node to a GraphNode. */
function toGraphNode(raw: Record<string, unknown>, edgeCount: number = 1): GraphNode {
  return {
    id: raw.id as string,
    label: (raw.title as string) || (raw.label as string) || (raw.id as string),
    kind: raw.kind as string,
    category: raw.category as string | undefined,
    sourceType: raw.sourceType as string | undefined,
    sourceId: raw.sourceId as string | undefined,
    content: raw.content as string | undefined,
    tags: raw.tags as string[] | undefined,
    workspaceId: raw.workspaceId as string | undefined,
    createdAt: raw.createdAt as string | undefined,
    updatedAt: raw.updatedAt as string | undefined,
    val: Math.max(1, edgeCount),
  };
}

/** Convert a raw WS edge to a GraphLink. */
function toGraphLink(raw: Record<string, unknown>): GraphLink {
  return {
    source: raw.fromId as string,
    target: raw.toId as string,
    type: raw.type as string,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Hook for managing Knowledge Graph state and WebSocket communication. */
export function useKnowledge(): UseKnowledgeResult {
  const { send, connected } = useGrackle();

  const [nodes, setNodes] = useState<Map<string, GraphNode>>(new Map());
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadRecent = useCallback((workspaceId?: string) => {
    if (!connected) {
      return;
    }
    setLoading(true);
    send({ type: "knowledge.listRecent", payload: { limit: 30, workspaceId } });
  }, [connected, send]);

  const search = useCallback((query: string) => {
    if (!connected || !query.trim()) {
      return;
    }
    setSearchQuery(query);
    setLoading(true);
    send({ type: "knowledge.search", payload: { query, limit: 20 } });
  }, [connected, send]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    loadRecent();
  }, [loadRecent]);

  const selectNode = useCallback((id: string) => {
    if (!connected) {
      return;
    }
    send({ type: "knowledge.getNode", payload: { id } });
  }, [connected, send]);

  const expandNode = useCallback((id: string) => {
    if (!connected) {
      return;
    }
    send({ type: "knowledge.expand", payload: { id, depth: 1 } });
  }, [connected, send]);

  // Process incoming WS messages — this needs to be wired into useGrackleSocket
  // For now, expose a processMessage method that the parent can call
  const processMessage = useCallback((msg: { type: string; payload?: Record<string, unknown> }) => {
    const payload = msg.payload ?? {};

    switch (msg.type) {
      case "knowledge.listRecent.result":
      case "knowledge.search.result": {
        const rawNodes = (payload.nodes ?? payload.results) as Record<string, unknown>[] | undefined;
        const rawEdges = (payload.edges ?? []) as Record<string, unknown>[];

        const nodeMap = new Map<string, GraphNode>();
        const linkList: GraphLink[] = [];

        if (msg.type === "knowledge.search.result" && payload.results) {
          // Search results have a different shape: { results: [{ score, node, edges }] }
          const results = payload.results as Array<Record<string, unknown>>;
          for (const result of results) {
            const rawNode = result.node as Record<string, unknown>;
            const resultEdges = (result.edges ?? []) as Record<string, unknown>[];
            if (rawNode) {
              nodeMap.set(rawNode.id as string, toGraphNode(rawNode, resultEdges.length));
            }
            for (const edge of resultEdges) {
              linkList.push(toGraphLink(edge));
            }
          }
        } else if (rawNodes) {
          for (const rawNode of rawNodes) {
            nodeMap.set(rawNode.id as string, toGraphNode(rawNode));
          }
          for (const edge of rawEdges) {
            linkList.push(toGraphLink(edge));
          }
        }

        // Update edge counts
        for (const link of linkList) {
          const src = nodeMap.get(link.source);
          if (src) {
            src.val = (src.val || 0) + 1;
          }
          const tgt = nodeMap.get(link.target);
          if (tgt) {
            tgt.val = (tgt.val || 0) + 1;
          }
        }

        setNodes(nodeMap);
        setLinks(linkList);
        setLoading(false);
        break;
      }

      case "knowledge.getNode.result": {
        if (payload.error) {
          setSelectedNode(null);
          return;
        }
        const rawNode = payload.node as Record<string, unknown>;
        const rawEdges = (payload.edges ?? []) as Record<string, unknown>[];
        if (rawNode) {
          setSelectedNode({
            node: toGraphNode(rawNode, rawEdges.length),
            edges: rawEdges.map((e) => ({
              fromId: e.fromId as string,
              toId: e.toId as string,
              type: e.type as string,
              metadata: e.metadata as Record<string, unknown> | undefined,
            })),
          });
        }
        break;
      }

      case "knowledge.expand.result": {
        const newNodes = (payload.nodes ?? []) as Record<string, unknown>[];
        const newEdges = (payload.edges ?? []) as Record<string, unknown>[];

        setNodes((prev) => {
          const updated = new Map(prev);
          for (const rawNode of newNodes) {
            if (!updated.has(rawNode.id as string)) {
              updated.set(rawNode.id as string, toGraphNode(rawNode));
            }
          }
          return updated;
        });

        setLinks((prev) => {
          const existing = new Set(prev.map((l) => `${l.source}:${l.target}:${l.type}`));
          const additions: GraphLink[] = [];
          for (const edge of newEdges) {
            const link = toGraphLink(edge);
            const key = `${link.source}:${link.target}:${link.type}`;
            if (!existing.has(key)) {
              additions.push(link);
            }
          }
          return [...prev, ...additions];
        });
        break;
      }
    }
  }, []);

  return {
    graphData: { nodes: [...nodes.values()], links },
    selectedNode,
    loading,
    searchQuery,
    search,
    clearSearch,
    selectNode,
    expandNode,
    loadRecent,
    // @ts-expect-error — processMessage is exposed for parent wiring
    processMessage,
  };
}
