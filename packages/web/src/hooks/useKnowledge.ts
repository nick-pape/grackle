/**
 * Data hook for the Knowledge Graph explorer.
 *
 * Uses ConnectRPC for all operations, following the same pattern as
 * other domain hooks (useFindings, useTasks, etc.).
 *
 * @module
 */

import { useState, useCallback, useRef } from "react";
import type { GrackleEvent } from "./types.js";
import { grackleClient } from "./useGrackleClient.js";
import { protoToGraphNode, protoToGraphLink } from "./proto-converters.js";

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
  /** Handle domain events from the event bus. Returns true if handled. */
  handleEvent(event: GrackleEvent): boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely parse a JSON string, returning undefined on failure. */
function safeParseJson(json: string): Record<string, unknown> | undefined {
  if (!json) {
    return undefined;
  }
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Hook for managing Knowledge Graph state via ConnectRPC. */
export function useKnowledge(): UseKnowledgeResult {
  const [nodes, setNodes] = useState<Map<string, GraphNode>>(new Map());
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeDetail | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  /** Tracks the active workspace filter so search and clearSearch can use it. */
  const workspaceIdRef = useRef("");

  const loadRecent = useCallback((workspaceId?: string) => {
    const effectiveWsId = workspaceId ?? "";
    workspaceIdRef.current = effectiveWsId;
    setSearchQuery("");
    setLoading(true);
    grackleClient.listRecentKnowledgeNodes({
      limit: 30,
      workspaceId: effectiveWsId,
    }).then(
      (resp) => {
        const nodeMap = new Map<string, GraphNode>();
        const linkList: GraphLink[] = [];

        for (const p of resp.nodes) {
          nodeMap.set(p.id, protoToGraphNode(p));
        }
        for (const e of resp.edges) {
          linkList.push(protoToGraphLink(e));
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
      },
      () => { setLoading(false); },
    );
  }, []);

  const search = useCallback((query: string) => {
    if (!query.trim()) {
      return;
    }
    setSearchQuery(query);
    setSelectedId(undefined);
    setSelectedNode(undefined);
    setLoading(true);
    grackleClient.searchKnowledge({ query, limit: 20, workspaceId: workspaceIdRef.current }).then(
      (resp) => {
        const nodeMap = new Map<string, GraphNode>();
        const linkList: GraphLink[] = [];

        for (const result of resp.results) {
          if (result.node) {
            nodeMap.set(result.node.id, protoToGraphNode(result.node, result.edges.length));
          }
          for (const e of result.edges) {
            linkList.push(protoToGraphLink(e));
          }
        }

        setNodes(nodeMap);
        setLinks(linkList);
        setLoading(false);
      },
      () => { setLoading(false); },
    );
  }, []);

  const clearSearch = useCallback(() => {
    loadRecent(workspaceIdRef.current);
  }, [loadRecent]);

  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    grackleClient.getKnowledgeNode({ id }).then(
      (resp) => {
        if (!resp.node) {
          setSelectedNode(undefined);
          return;
        }
        setSelectedNode({
          node: protoToGraphNode(resp.node, resp.edges.length),
          edges: resp.edges.map((e) => ({
            fromId: e.fromId,
            toId: e.toId,
            type: e.type,
            metadata: safeParseJson(e.metadataJson),
          })),
        });
      },
      () => { setSelectedNode(undefined); },
    );
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(undefined);
    setSelectedNode(undefined);
  }, []);

  const expandNode = useCallback((id: string) => {
    grackleClient.expandKnowledgeNode({ id, depth: 1 }).then(
      (resp) => {
        setNodes((prev) => {
          const updated = new Map(prev);
          for (const p of resp.nodes) {
            if (!updated.has(p.id)) {
              updated.set(p.id, protoToGraphNode(p));
            }
          }
          return updated;
        });

        setLinks((prev) => {
          const existing = new Set(prev.map((l) => `${l.source}:${l.target}:${l.type}`));
          const additions: GraphLink[] = [];
          for (const e of resp.edges) {
            const link = protoToGraphLink(e);
            const key = `${link.source}:${link.target}:${link.type}`;
            if (!existing.has(key)) {
              additions.push(link);
            }
          }
          return [...prev, ...additions];
        });
      },
      () => {},
    );
  }, []);

  /** Handle domain events from the event bus. */
  const handleEvent = useCallback((_event: GrackleEvent): boolean => {
    // No knowledge-specific events are emitted yet.
    // Future: react to knowledge.node.created, etc.
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
    handleEvent,
  };
}
