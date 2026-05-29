/**
 * Data hook for the Knowledge Graph explorer.
 *
 * Uses ConnectRPC for all operations, following the same pattern as
 * other domain hooks (useTasks, useWorkspaces, etc.).
 *
 * @module
 */

import { useState, useCallback, useRef, useMemo } from "react";
import { ConnectError, Code } from "@connectrpc/connect";
import type {
  GrackleEvent,
  GraphNode,
  GraphLink,
  KnowledgeLoadError,
  NodeDetail,
  UseKnowledgeResult,
} from "@grackle-ai/web-components";
import type { DomainHook } from "./domainHook.js";
import { knowledgeClient as grackleClient } from "./useGrackleClient.js";
import { protoToGraphNode, protoToGraphLink } from "./proto-converters.js";

// ---------------------------------------------------------------------------
// Types (re-exported from shared types module)
// ---------------------------------------------------------------------------

export type {
  GraphNode,
  GraphLink,
  KnowledgeLoadError,
  NodeDetail,
  UseKnowledgeResult,
} from "@grackle-ai/web-components";

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

/**
 * Classify a failed knowledge RPC into a {@link KnowledgeLoadError}.
 *
 * The backend throws `ConnectError` with `Code.Unavailable` when Neo4j is not
 * running or unreachable; that maps to the "knowledge server can't be reached"
 * UX. Everything else is a generic `"error"`.
 */
function classifyLoadError(err: unknown): KnowledgeLoadError {
  return ConnectError.from(err).code === Code.Unavailable ? "unavailable" : "error";
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
  const [loadError, setLoadError] = useState<KnowledgeLoadError | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");

  /** Tracks the active workspace filter so search and clearSearch can use it. */
  const workspaceIdRef = useRef("");

  const loadRecent = useCallback(async (workspaceId?: string) => {
    const effectiveWsId = workspaceId ?? "";
    workspaceIdRef.current = effectiveWsId;
    setSearchQuery("");
    setLoadError(undefined);
    setLoading(true);
    try {
      const resp = await grackleClient.listRecentKnowledgeNodes({
        limit: 30,
        workspaceId: effectiveWsId,
      });
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
        if (src) {
          src.val += 1;
        }
        const tgt = nodeMap.get(link.target);
        if (tgt) {
          tgt.val += 1;
        }
      }

      setNodes(nodeMap);
      setLinks(linkList);
    } catch (err) {
      setLoadError(classifyLoadError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      return;
    }
    setSearchQuery(query);
    setSelectedId(undefined);
    setSelectedNode(undefined);
    setLoadError(undefined);
    setLoading(true);
    try {
      const resp = await grackleClient.searchKnowledge({
        query,
        limit: 20,
        workspaceId: workspaceIdRef.current,
      });
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
    } catch (err) {
      setLoadError(classifyLoadError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    loadRecent(workspaceIdRef.current).catch(() => {});
  }, [loadRecent]);

  const selectNode = useCallback(async (id: string) => {
    setSelectedId(id);
    try {
      const resp = await grackleClient.getKnowledgeNode({ id });
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
    } catch {
      setSelectedNode(undefined);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(undefined);
    setSelectedNode(undefined);
  }, []);

  const expandNode = useCallback(async (id: string) => {
    try {
      const resp = await grackleClient.expandKnowledgeNode({ id, depth: 1 });
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
    } catch {
      // empty
    }
  }, []);

  /** Handle domain events from the event bus. */
  const handleEvent = useCallback((_event: GrackleEvent): boolean => {
    // No knowledge-specific events are emitted yet.
    // Future: react to knowledge.node.created, etc.
    return false;
  }, []);

  // Knowledge is page-scoped; no global reload needed. Memoized so the hook's
  // public object identity stays stable across renders (see return below).
  const domainHook = useMemo<DomainHook>(
    () => ({
      onConnect: async () => {},
      onDisconnect: () => {},
      handleEvent,
    }),
    [handleEvent],
  );

  // Derive graphData only when the underlying node/link state changes, so the
  // force-directed graph isn't handed a brand-new prop (and re-simulated) on
  // every unrelated render.
  const graphData = useMemo(() => ({ nodes: [...nodes.values()], links }), [nodes, links]);

  // Hardening (#1357): return a referentially stable object. All callbacks are
  // stable (`useCallback([])`) and `graphData`/`domainHook` are memoized, so
  // this object only changes identity when real state changes. That keeps the
  // `knowledge` slice from re-triggering consumer effects/`useCallback`s that
  // depend on it on every render — the render-loop footgun that froze the tab.
  return useMemo<UseKnowledgeResult>(
    () => ({
      graphData,
      selectedNode,
      selectedId,
      loading,
      loadError,
      searchQuery,
      search,
      clearSearch,
      selectNode,
      clearSelection,
      expandNode,
      loadRecent,
      handleEvent,
      domainHook,
    }),
    [
      graphData,
      selectedNode,
      selectedId,
      loading,
      loadError,
      searchQuery,
      search,
      clearSearch,
      selectNode,
      clearSelection,
      expandNode,
      loadRecent,
      handleEvent,
      domainHook,
    ],
  );
}
