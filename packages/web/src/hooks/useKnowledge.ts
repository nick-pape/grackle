/**
 * Data hook for the Knowledge Graph explorer.
 *
 * Follows the same pattern as other domain hooks (environments, tasks, etc.):
 * exposes a `handleMessage` function for WS message routing and action
 * functions that call `send()`.
 *
 * @module
 */

import { useState, useCallback } from "react";
import type { WsMessage, SendFunction } from "./types.js";

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
  selectedNode: NodeDetail | undefined;
  /** Currently selected node ID. */
  selectedId: string | undefined;
  loading: boolean;
  searchQuery: string;
  search(query: string): void;
  clearSearch(): void;
  selectNode(id: string): void;
  clearSelection(): void;
  expandNode(id: string): void;
  loadRecent(workspaceId?: string): void;
  /** Handle incoming WS messages — called by useGrackleSocket. */
  handleMessage(msg: WsMessage): boolean;
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
    val: edgeCount,
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

/** Knowledge-related WS message types. */
const KNOWLEDGE_MSG_TYPES: ReadonlySet<string> = new Set([
  "knowledge.listRecent.result",
  "knowledge.search.result",
  "knowledge.getNode.result",
  "knowledge.expand.result",
]);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Hook for managing Knowledge Graph state and WebSocket communication. */
export function useKnowledge(send: SendFunction): UseKnowledgeResult {
  const [nodes, setNodes] = useState<Map<string, GraphNode>>(new Map());
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeDetail | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadRecent = useCallback((workspaceId?: string) => {
    setLoading(true);
    send({ type: "knowledge.listRecent", payload: { limit: 30, workspaceId } });
  }, [send]);

  const search = useCallback((query: string) => {
    if (!query.trim()) {
      return;
    }
    setSearchQuery(query);
    setSelectedId(undefined);
    setSelectedNode(undefined);
    setLoading(true);
    send({ type: "knowledge.search", payload: { query, limit: 20 } });
  }, [send]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    loadRecent();
  }, [loadRecent]);

  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    send({ type: "knowledge.getNode", payload: { id } });
  }, [send]);

  const clearSelection = useCallback(() => {
    setSelectedId(undefined);
    setSelectedNode(undefined);
  }, []);

  const expandNode = useCallback((id: string) => {
    send({ type: "knowledge.expand", payload: { id, depth: 1 } });
  }, [send]);

  /** Handle incoming WS messages. Returns true if handled. */
  const handleMessage = useCallback((msg: WsMessage): boolean => {
    if (!KNOWLEDGE_MSG_TYPES.has(msg.type)) {
      return false;
    }

    const payload: Record<string, unknown> = (msg.payload ?? {}) as Record<string, unknown>;

    switch (msg.type) {
      case "knowledge.listRecent.result": {
        if (payload.error) {
          setLoading(false);
          return true;
        }
        const rawNodes = (payload.nodes ?? []) as Record<string, unknown>[];
        const rawEdges = (payload.edges ?? []) as Record<string, unknown>[];

        const nodeMap = new Map<string, GraphNode>();
        const linkList: GraphLink[] = [];

        for (const rawNode of rawNodes) {
          nodeMap.set(rawNode.id as string, toGraphNode(rawNode));
        }
        for (const edge of rawEdges) {
          linkList.push(toGraphLink(edge));
        }

        // Update edge counts
        for (const link of linkList) {
          const src = nodeMap.get(link.source);
          if (src) { src.val += 1; }
          const tgt = nodeMap.get(link.target);
          if (tgt) { tgt.val += 1; }
        }

        setNodes(nodeMap);
        setLinks(linkList);
        setLoading(false);
        return true;
      }

      case "knowledge.search.result": {
        if (payload.error) {
          setLoading(false);
          return true;
        }
        const results = (payload.results ?? []) as Array<Record<string, unknown>>;
        const nodeMap = new Map<string, GraphNode>();
        const linkList: GraphLink[] = [];

        for (const result of results) {
          const rawNode = result.node as Record<string, unknown>;
          const resultEdges = (result.edges ?? []) as Record<string, unknown>[];
          nodeMap.set(rawNode.id as string, toGraphNode(rawNode, resultEdges.length));
          for (const edge of resultEdges) {
            linkList.push(toGraphLink(edge));
          }
        }

        setNodes(nodeMap);
        setLinks(linkList);
        setLoading(false);
        return true;
      }

      case "knowledge.getNode.result": {
        if (payload.error) {
          setSelectedNode(undefined);
          return true;
        }
        const rawNode = payload.node as Record<string, unknown>;
        const rawEdges = (payload.edges ?? []) as Record<string, unknown>[];
        setSelectedNode({
          node: toGraphNode(rawNode, rawEdges.length),
          edges: rawEdges.map((e) => ({
            fromId: e.fromId as string,
            toId: e.toId as string,
            type: e.type as string,
            metadata: e.metadata as Record<string, unknown> | undefined,
          })),
        });
        return true;
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
        return true;
      }
    }

    return false;
  }, []);

  return {
    graphData: { nodes: [...nodes.values()], links },
    selectedNode,
    selectedId,
    loading,
    searchQuery,
    search,
    clearSearch,
    selectNode,
    clearSelection,
    expandNode,
    loadRecent,
    handleMessage,
  };
}
