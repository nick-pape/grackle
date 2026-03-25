// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useKnowledge } from "./useKnowledge.js";

function setup(): {
  result: { current: ReturnType<typeof useKnowledge> };
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  const { result } = renderHook(() => useKnowledge(send));
  return { result, send };
}

describe("useKnowledge", () => {
  // ── Initial state ──────────────────────────────────────────────

  it("starts with empty graph, no selection, not loading", () => {
    const { result } = setup();
    expect(result.current.graphData).toEqual({ nodes: [], links: [] });
    expect(result.current.selectedNode).toBeUndefined();
    expect(result.current.selectedId).toBeUndefined();
    expect(result.current.loading).toBe(false);
    expect(result.current.searchQuery).toBe("");
  });

  // ── Action functions ───────────────────────────────────────────

  describe("loadRecent", () => {
    it("sends knowledge.listRecent and sets loading", () => {
      const { result, send } = setup();
      act(() => result.current.loadRecent());
      expect(send).toHaveBeenCalledWith({
        type: "knowledge.listRecent",
        payload: { limit: 30, workspaceId: undefined },
      });
      expect(result.current.loading).toBe(true);
    });

    it("passes workspaceId through", () => {
      const { result, send } = setup();
      act(() => result.current.loadRecent("ws-1"));
      expect(send).toHaveBeenCalledWith({
        type: "knowledge.listRecent",
        payload: { limit: 30, workspaceId: "ws-1" },
      });
    });
  });

  describe("search", () => {
    it("sends knowledge.search and sets loading + searchQuery", () => {
      const { result, send } = setup();
      act(() => result.current.search("test query"));
      expect(send).toHaveBeenCalledWith({
        type: "knowledge.search",
        payload: { query: "test query", limit: 20 },
      });
      expect(result.current.loading).toBe(true);
      expect(result.current.searchQuery).toBe("test query");
    });

    it("is a no-op for whitespace-only input", () => {
      const { result, send } = setup();
      act(() => result.current.search("   "));
      expect(send).not.toHaveBeenCalled();
      expect(result.current.loading).toBe(false);
    });

    it("clears selection when searching", () => {
      const { result } = setup();
      act(() => result.current.selectNode("n1"));
      expect(result.current.selectedId).toBe("n1");

      act(() => result.current.search("query"));
      expect(result.current.selectedId).toBeUndefined();
      expect(result.current.selectedNode).toBeUndefined();
    });
  });

  describe("clearSearch", () => {
    it("resets searchQuery and triggers loadRecent", () => {
      const { result, send } = setup();
      act(() => result.current.search("query"));
      send.mockClear();

      act(() => result.current.clearSearch());
      expect(result.current.searchQuery).toBe("");
      expect(send).toHaveBeenCalledWith({
        type: "knowledge.listRecent",
        payload: { limit: 30, workspaceId: undefined },
      });
    });
  });

  describe("selectNode", () => {
    it("sends knowledge.getNode and sets selectedId", () => {
      const { result, send } = setup();
      act(() => result.current.selectNode("n1"));
      expect(send).toHaveBeenCalledWith({
        type: "knowledge.getNode",
        payload: { id: "n1" },
      });
      expect(result.current.selectedId).toBe("n1");
    });
  });

  describe("clearSelection", () => {
    it("resets selectedId and selectedNode", () => {
      const { result } = setup();
      // Select a node and deliver its detail
      act(() => result.current.selectNode("n1"));
      act(() => {
        result.current.handleMessage({
          type: "knowledge.getNode.result",
          payload: {
            node: { id: "n1", kind: "native", title: "N1" },
            edges: [],
          },
        });
      });
      expect(result.current.selectedId).toBe("n1");
      expect(result.current.selectedNode).toBeDefined();

      act(() => result.current.clearSelection());
      expect(result.current.selectedId).toBeUndefined();
      expect(result.current.selectedNode).toBeUndefined();
    });
  });

  describe("expandNode", () => {
    it("sends knowledge.expand with depth 1", () => {
      const { result, send } = setup();
      act(() => result.current.expandNode("n1"));
      expect(send).toHaveBeenCalledWith({
        type: "knowledge.expand",
        payload: { id: "n1", depth: 1 },
      });
    });
  });

  // ── handleMessage ──────────────────────────────────────────────

  describe("handleMessage", () => {
    it("returns false for non-knowledge messages", () => {
      const { result } = setup();
      let handled!: boolean;
      act(() => {
        handled = result.current.handleMessage({ type: "environments", payload: {} });
      });
      expect(handled).toBe(false);
    });

    // ── listRecent.result ──────────────────────────────────────

    describe("knowledge.listRecent.result", () => {
      it("populates graph with nodes and links", () => {
        const { result } = setup();
        act(() => result.current.loadRecent());

        let handled!: boolean;
        act(() => {
          handled = result.current.handleMessage({
            type: "knowledge.listRecent.result",
            payload: {
              nodes: [
                { id: "n1", kind: "native", title: "Node 1", category: "insight" },
                { id: "n2", kind: "reference", label: "Ref 1", sourceType: "task", sourceId: "t1" },
              ],
              edges: [
                { fromId: "n1", toId: "n2", type: "RELATES_TO" },
              ],
            },
          });
        });

        expect(handled).toBe(true);
        expect(result.current.loading).toBe(false);
        expect(result.current.graphData.nodes).toHaveLength(2);
        expect(result.current.graphData.links).toHaveLength(1);

        const node1 = result.current.graphData.nodes.find((n) => n.id === "n1");
        expect(node1).toBeDefined();
        expect(node1!.label).toBe("Node 1");
        expect(node1!.kind).toBe("native");
        expect(node1!.val).toBe(1);

        const node2 = result.current.graphData.nodes.find((n) => n.id === "n2");
        expect(node2).toBeDefined();
        expect(node2!.label).toBe("Ref 1");
        expect(node2!.val).toBe(1);

        expect(result.current.graphData.links[0]).toEqual({
          source: "n1",
          target: "n2",
          type: "RELATES_TO",
        });
      });

      it("sets loading=false on error without crashing", () => {
        const { result } = setup();
        act(() => result.current.loadRecent());

        let handled!: boolean;
        act(() => {
          handled = result.current.handleMessage({
            type: "knowledge.listRecent.result",
            payload: { error: "not available" },
          });
        });

        expect(handled).toBe(true);
        expect(result.current.loading).toBe(false);
        expect(result.current.graphData.nodes).toHaveLength(0);
      });
    });

    // ── search.result ──────────────────────────────────────────

    describe("knowledge.search.result", () => {
      it("populates graph from search results with edge counts", () => {
        const { result } = setup();
        act(() => result.current.search("test"));

        let handled!: boolean;
        act(() => {
          handled = result.current.handleMessage({
            type: "knowledge.search.result",
            payload: {
              results: [
                {
                  score: 0.95,
                  node: { id: "n1", kind: "native", title: "Match" },
                  edges: [{ fromId: "n1", toId: "n2", type: "MENTIONS" }],
                },
                {
                  score: 0.8,
                  node: { id: "n2", kind: "native", title: "Other" },
                  edges: [],
                },
              ],
            },
          });
        });

        expect(handled).toBe(true);
        expect(result.current.loading).toBe(false);
        expect(result.current.graphData.nodes).toHaveLength(2);
        expect(result.current.graphData.links).toHaveLength(1);

        const match = result.current.graphData.nodes.find((n) => n.id === "n1");
        expect(match!.val).toBe(1);

        const other = result.current.graphData.nodes.find((n) => n.id === "n2");
        expect(other!.val).toBe(0);
      });

      it("sets loading=false on error", () => {
        const { result } = setup();
        act(() => result.current.search("test"));

        act(() => {
          result.current.handleMessage({
            type: "knowledge.search.result",
            payload: { error: "search failed" },
          });
        });

        expect(result.current.loading).toBe(false);
      });
    });

    // ── getNode.result ─────────────────────────────────────────

    describe("knowledge.getNode.result", () => {
      it("sets selectedNode with converted node and edges", () => {
        const { result } = setup();

        act(() => {
          result.current.handleMessage({
            type: "knowledge.getNode.result",
            payload: {
              node: { id: "n1", kind: "native", title: "Detail Node", content: "body", tags: ["a"] },
              edges: [
                { fromId: "n1", toId: "n2", type: "MENTIONS", metadata: { weight: 1 } },
              ],
            },
          });
        });

        expect(result.current.selectedNode).toBeDefined();
        expect(result.current.selectedNode!.node.id).toBe("n1");
        expect(result.current.selectedNode!.node.label).toBe("Detail Node");
        expect(result.current.selectedNode!.node.content).toBe("body");
        expect(result.current.selectedNode!.node.tags).toEqual(["a"]);
        expect(result.current.selectedNode!.node.val).toBe(1);
        expect(result.current.selectedNode!.edges).toHaveLength(1);
        expect(result.current.selectedNode!.edges[0]).toEqual({
          fromId: "n1",
          toId: "n2",
          type: "MENTIONS",
          metadata: { weight: 1 },
        });
      });

      it("clears selectedNode on error", () => {
        const { result } = setup();

        // First set a selected node
        act(() => {
          result.current.handleMessage({
            type: "knowledge.getNode.result",
            payload: { node: { id: "n1", kind: "native", title: "Node" }, edges: [] },
          });
        });
        expect(result.current.selectedNode).toBeDefined();

        act(() => {
          result.current.handleMessage({
            type: "knowledge.getNode.result",
            payload: { error: "not found" },
          });
        });
        expect(result.current.selectedNode).toBeUndefined();
      });
    });

    // ── expand.result ──────────────────────────────────────────

    describe("knowledge.expand.result", () => {
      it("merges new nodes without overwriting existing ones", () => {
        const { result } = setup();

        // Seed initial graph
        act(() => {
          result.current.handleMessage({
            type: "knowledge.listRecent.result",
            payload: {
              nodes: [{ id: "n1", kind: "native", title: "Original" }],
              edges: [],
            },
          });
        });
        expect(result.current.graphData.nodes).toHaveLength(1);

        // Expand with a new node and a duplicate
        act(() => {
          result.current.handleMessage({
            type: "knowledge.expand.result",
            payload: {
              nodes: [
                { id: "n2", kind: "native", title: "New Node" },
                { id: "n1", kind: "native", title: "Overwritten?" },
              ],
              edges: [{ fromId: "n1", toId: "n2", type: "RELATES_TO" }],
            },
          });
        });

        expect(result.current.graphData.nodes).toHaveLength(2);
        expect(result.current.graphData.links).toHaveLength(1);

        // Existing node should NOT be overwritten
        const n1 = result.current.graphData.nodes.find((n) => n.id === "n1");
        expect(n1!.label).toBe("Original");
      });

      it("deduplicates edges by source:target:type key", () => {
        const { result } = setup();

        // Seed initial graph with one edge
        act(() => {
          result.current.handleMessage({
            type: "knowledge.listRecent.result",
            payload: {
              nodes: [
                { id: "n1", kind: "native", title: "A" },
                { id: "n2", kind: "native", title: "B" },
              ],
              edges: [{ fromId: "n1", toId: "n2", type: "RELATES_TO" }],
            },
          });
        });
        expect(result.current.graphData.links).toHaveLength(1);

        // Expand with a duplicate edge and a new one
        act(() => {
          result.current.handleMessage({
            type: "knowledge.expand.result",
            payload: {
              nodes: [{ id: "n3", kind: "native", title: "C" }],
              edges: [
                { fromId: "n1", toId: "n2", type: "RELATES_TO" }, // duplicate
                { fromId: "n1", toId: "n3", type: "MENTIONS" },   // new
              ],
            },
          });
        });

        expect(result.current.graphData.links).toHaveLength(2);
      });

      it("handles empty expand result gracefully", () => {
        const { result } = setup();

        // Seed initial graph
        act(() => {
          result.current.handleMessage({
            type: "knowledge.listRecent.result",
            payload: {
              nodes: [{ id: "n1", kind: "native", title: "A" }],
              edges: [],
            },
          });
        });

        act(() => {
          result.current.handleMessage({
            type: "knowledge.expand.result",
            payload: { nodes: [], edges: [] },
          });
        });

        expect(result.current.graphData.nodes).toHaveLength(1);
        expect(result.current.graphData.links).toHaveLength(0);
      });
    });
  });
});
