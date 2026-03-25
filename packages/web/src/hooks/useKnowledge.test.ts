// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useKnowledge } from "./useKnowledge.js";

// ---------------------------------------------------------------------------
// Mock grackleClient (vi.hoisted ensures the object exists before vi.mock runs)
// ---------------------------------------------------------------------------

const mockClient = vi.hoisted(() => ({
  listRecentKnowledgeNodes: vi.fn(),
  searchKnowledge: vi.fn(),
  getKnowledgeNode: vi.fn(),
  expandKnowledgeNode: vi.fn(),
}));

vi.mock("./useGrackleClient.js", () => ({
  grackleClient: mockClient,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a proto-like KnowledgeNodeProto. */
function makeProtoNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "n1",
    kind: "native",
    title: "Node 1",
    label: "",
    category: "insight",
    sourceType: "",
    sourceId: "",
    content: "",
    tags: [],
    workspaceId: "",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

/** Create a proto-like KnowledgeEdgeProto. */
function makeProtoEdge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fromId: "n1",
    toId: "n2",
    type: "RELATES_TO",
    metadataJson: "",
    createdAt: "",
    ...overrides,
  };
}

function setup(): { result: { current: ReturnType<typeof useKnowledge> } } {
  const { result } = renderHook(() => useKnowledge());
  return { result };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

  // ── loadRecent ────────────────────────────────────────────────

  describe("loadRecent", () => {
    it("calls listRecentKnowledgeNodes and populates graph", async () => {
      mockClient.listRecentKnowledgeNodes.mockResolvedValue({
        nodes: [
          makeProtoNode({ id: "n1", title: "Node 1" }),
          makeProtoNode({ id: "n2", kind: "reference", title: "Ref 1", sourceType: "task", sourceId: "t1" }),
        ],
        edges: [makeProtoEdge({ fromId: "n1", toId: "n2", type: "RELATES_TO" })],
      });

      const { result } = setup();
      act(() => { result.current.loadRecent(); });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockClient.listRecentKnowledgeNodes).toHaveBeenCalledWith({
        limit: 30,
        workspaceId: "",
      });
      expect(result.current.graphData.nodes).toHaveLength(2);
      expect(result.current.graphData.links).toHaveLength(1);

      const node1 = result.current.graphData.nodes.find((n) => n.id === "n1");
      expect(node1!.label).toBe("Node 1");
      expect(node1!.val).toBe(1); // one edge touches n1

      const node2 = result.current.graphData.nodes.find((n) => n.id === "n2");
      expect(node2!.label).toBe("Ref 1");
      expect(node2!.val).toBe(1);
    });

    it("passes workspaceId through", () => {
      mockClient.listRecentKnowledgeNodes.mockResolvedValue({ nodes: [], edges: [] });
      const { result } = setup();
      act(() => { result.current.loadRecent("ws-1"); });
      expect(mockClient.listRecentKnowledgeNodes).toHaveBeenCalledWith({
        limit: 30,
        workspaceId: "ws-1",
      });
    });

    it("sets loading=false on error", async () => {
      mockClient.listRecentKnowledgeNodes.mockRejectedValue(new Error("unavailable"));
      const { result } = setup();
      act(() => { result.current.loadRecent(); });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  // ── search ────────────────────────────────────────────────────

  describe("search", () => {
    it("calls searchKnowledge and populates graph", async () => {
      mockClient.searchKnowledge.mockResolvedValue({
        results: [
          { score: 0.95, node: makeProtoNode({ id: "n1", title: "Match" }), edges: [makeProtoEdge()] },
          { score: 0.8, node: makeProtoNode({ id: "n2", title: "Other" }), edges: [] },
        ],
      });

      const { result } = setup();
      act(() => { result.current.search("test query"); });

      expect(result.current.loading).toBe(true);
      expect(result.current.searchQuery).toBe("test query");

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.graphData.nodes).toHaveLength(2);
      expect(result.current.graphData.links).toHaveLength(1);

      const match = result.current.graphData.nodes.find((n) => n.id === "n1");
      expect(match!.val).toBe(1); // edge count from search results
    });

    it("is a no-op for whitespace-only input", () => {
      const { result } = setup();
      act(() => { result.current.search("   "); });
      expect(mockClient.searchKnowledge).not.toHaveBeenCalled();
      expect(result.current.loading).toBe(false);
    });

    it("clears selection when searching", () => {
      mockClient.getKnowledgeNode.mockResolvedValue({ node: makeProtoNode(), edges: [] });
      const { result } = setup();
      act(() => { result.current.selectNode("n1"); });
      expect(result.current.selectedId).toBe("n1");

      mockClient.searchKnowledge.mockResolvedValue({ results: [] });
      act(() => { result.current.search("query"); });
      expect(result.current.selectedId).toBeUndefined();
      expect(result.current.selectedNode).toBeUndefined();
    });
  });

  // ── clearSearch ───────────────────────────────────────────────

  describe("clearSearch", () => {
    it("resets searchQuery and triggers loadRecent", () => {
      mockClient.searchKnowledge.mockResolvedValue({ results: [] });
      mockClient.listRecentKnowledgeNodes.mockResolvedValue({ nodes: [], edges: [] });

      const { result } = setup();
      act(() => { result.current.search("query"); });
      mockClient.listRecentKnowledgeNodes.mockClear();

      act(() => { result.current.clearSearch(); });
      expect(result.current.searchQuery).toBe("");
      expect(mockClient.listRecentKnowledgeNodes).toHaveBeenCalled();
    });
  });

  // ── selectNode ────────────────────────────────────────────────

  describe("selectNode", () => {
    it("calls getKnowledgeNode and sets selectedNode", async () => {
      mockClient.getKnowledgeNode.mockResolvedValue({
        node: makeProtoNode({ id: "n1", title: "Detail Node", content: "body", tags: ["a"] }),
        edges: [makeProtoEdge({ fromId: "n1", toId: "n2", type: "MENTIONS", metadataJson: '{"weight":1}' })],
      });

      const { result } = setup();
      act(() => { result.current.selectNode("n1"); });

      expect(result.current.selectedId).toBe("n1");

      await waitFor(() => {
        expect(result.current.selectedNode).toBeDefined();
      });

      expect(result.current.selectedNode!.node.id).toBe("n1");
      expect(result.current.selectedNode!.node.label).toBe("Detail Node");
      expect(result.current.selectedNode!.node.content).toBe("body");
      expect(result.current.selectedNode!.node.tags).toEqual(["a"]);
      expect(result.current.selectedNode!.node.val).toBe(1);
      expect(result.current.selectedNode!.edges).toHaveLength(1);
      expect(result.current.selectedNode!.edges[0].metadata).toEqual({ weight: 1 });
    });

    it("clears selectedNode on error", async () => {
      mockClient.getKnowledgeNode.mockRejectedValue(new Error("not found"));

      const { result } = setup();
      act(() => { result.current.selectNode("n1"); });

      await waitFor(() => {
        expect(result.current.selectedNode).toBeUndefined();
      });
    });
  });

  // ── clearSelection ────────────────────────────────────────────

  describe("clearSelection", () => {
    it("resets selectedId and selectedNode", () => {
      mockClient.getKnowledgeNode.mockResolvedValue({ node: makeProtoNode(), edges: [] });
      const { result } = setup();
      act(() => { result.current.selectNode("n1"); });
      expect(result.current.selectedId).toBe("n1");

      act(() => { result.current.clearSelection(); });
      expect(result.current.selectedId).toBeUndefined();
      expect(result.current.selectedNode).toBeUndefined();
    });
  });

  // ── expandNode ────────────────────────────────────────────────

  describe("expandNode", () => {
    it("calls expandKnowledgeNode and merges new nodes", async () => {
      // Seed initial graph
      mockClient.listRecentKnowledgeNodes.mockResolvedValue({
        nodes: [makeProtoNode({ id: "n1", title: "Original" })],
        edges: [],
      });
      const { result } = setup();
      act(() => { result.current.loadRecent(); });
      await waitFor(() => { expect(result.current.graphData.nodes).toHaveLength(1); });

      // Expand
      mockClient.expandKnowledgeNode.mockResolvedValue({
        nodes: [
          makeProtoNode({ id: "n2", title: "New Node" }),
          makeProtoNode({ id: "n1", title: "Overwritten?" }), // duplicate
        ],
        edges: [makeProtoEdge({ fromId: "n1", toId: "n2", type: "RELATES_TO" })],
      });
      act(() => { result.current.expandNode("n1"); });

      await waitFor(() => {
        expect(result.current.graphData.nodes).toHaveLength(2);
      });

      // Existing node should NOT be overwritten
      const n1 = result.current.graphData.nodes.find((n) => n.id === "n1");
      expect(n1!.label).toBe("Original");
      expect(result.current.graphData.links).toHaveLength(1);
    });

    it("deduplicates edges by source:target:type key", async () => {
      mockClient.listRecentKnowledgeNodes.mockResolvedValue({
        nodes: [makeProtoNode({ id: "n1" }), makeProtoNode({ id: "n2" })],
        edges: [makeProtoEdge({ fromId: "n1", toId: "n2", type: "RELATES_TO" })],
      });
      const { result } = setup();
      act(() => { result.current.loadRecent(); });
      await waitFor(() => { expect(result.current.graphData.links).toHaveLength(1); });

      mockClient.expandKnowledgeNode.mockResolvedValue({
        nodes: [makeProtoNode({ id: "n3" })],
        edges: [
          makeProtoEdge({ fromId: "n1", toId: "n2", type: "RELATES_TO" }), // duplicate
          makeProtoEdge({ fromId: "n1", toId: "n3", type: "MENTIONS" }),   // new
        ],
      });
      act(() => { result.current.expandNode("n1"); });

      await waitFor(() => {
        expect(result.current.graphData.links).toHaveLength(2);
      });
    });
  });

  // ── handleEvent ───────────────────────────────────────────────

  describe("handleEvent", () => {
    it("returns false for all events (no knowledge events yet)", () => {
      const { result } = setup();
      let handled!: boolean;
      act(() => {
        handled = result.current.handleEvent({
          id: "ev-1",
          type: "task.created",
          timestamp: new Date().toISOString(),
          payload: { taskId: "t1" },
        });
      });
      expect(handled).toBe(false);
    });
  });
});
