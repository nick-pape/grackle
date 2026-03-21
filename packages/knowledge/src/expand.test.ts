import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SearchResult } from "./search.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSessionRun, mockSessionClose, mockSession } = vi.hoisted(() => {
  const mockSessionRun = vi.fn().mockResolvedValue({ records: [] });
  const mockSessionClose = vi.fn().mockResolvedValue(undefined);
  const mockSession = { run: mockSessionRun, close: mockSessionClose };
  return { mockSessionRun, mockSessionClose, mockSession };
});

vi.mock("./client.js", () => ({
  getSession: vi.fn(() => mockSession),
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { expandNode, expandResults } from "./expand.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNeo4jRecord(data: Record<string, unknown>) {
  return { get: (key: string) => data[key] };
}

function makeNeo4jNode(properties: Record<string, unknown>) {
  return { properties };
}

const NODE_A: Record<string, unknown> = {
  id: "node-a",
  kind: "native",
  category: "insight",
  title: "Node A",
  content: "Content A",
  tags: [],
  embedding: [0.1],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  workspaceId: "ws-1",
};

const NODE_B: Record<string, unknown> = {
  id: "node-b",
  kind: "reference",
  sourceType: "task",
  sourceId: "task-1",
  label: "Node B",
  embedding: [0.2],
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  workspaceId: "ws-1",
};

const NODE_C: Record<string, unknown> = {
  id: "node-c",
  kind: "native",
  category: "decision",
  title: "Node C",
  content: "Content C",
  tags: [],
  embedding: [0.3],
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
  workspaceId: "ws-1",
};

const EDGE_AB = {
  fromId: "node-a",
  toId: "node-b",
  type: "RELATES_TO",
  metadata: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const EDGE_BC = {
  fromId: "node-b",
  toId: "node-c",
  type: "DEPENDS_ON",
  metadata: null,
  createdAt: "2026-01-02T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("expandNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionRun.mockResolvedValue({ records: [] });
  });

  it("should return immediate neighbors at depth 1", async () => {
    mockSessionRun.mockResolvedValue({
      records: [
        makeNeo4jRecord({
          neighbor: makeNeo4jNode(NODE_B),
          rels: [EDGE_AB],
        }),
      ],
    });

    const result = await expandNode("node-a");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe("node-b");
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].type).toBe("RELATES_TO");
  });

  it("should pass depth parameter to Cypher", async () => {
    await expandNode("node-a", { depth: 3 });

    const params = mockSessionRun.mock.calls[0][1] as Record<string, unknown>;
    expect(params.depth).toBe(3);
  });

  it("should default to depth 1", async () => {
    await expandNode("node-a");

    const params = mockSessionRun.mock.calls[0][1] as Record<string, unknown>;
    expect(params.depth).toBe(1);
  });

  it("should include edge type filter in Cypher when specified", async () => {
    await expandNode("node-a", { edgeTypes: ["RELATES_TO", "DEPENDS_ON"] });

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).toContain("RELATES_TO|DEPENDS_ON");
  });

  it("should not include edge type filter when not specified", async () => {
    await expandNode("node-a");

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).not.toContain("RELATES_TO");
    expect(cypher).toContain("[*1..$depth]");
  });

  it("should deduplicate nodes reachable via multiple paths", async () => {
    mockSessionRun.mockResolvedValue({
      records: [
        makeNeo4jRecord({
          neighbor: makeNeo4jNode(NODE_B),
          rels: [EDGE_AB],
        }),
        makeNeo4jRecord({
          neighbor: makeNeo4jNode(NODE_B),
          rels: [EDGE_AB],
        }),
      ],
    });

    const result = await expandNode("node-a");
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
  });

  it("should return empty result when no neighbors exist", async () => {
    mockSessionRun.mockResolvedValue({ records: [] });

    const result = await expandNode("node-a");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("should always close the session", async () => {
    mockSessionRun.mockRejectedValue(new Error("Neo4j error"));

    await expect(expandNode("node-a")).rejects.toThrow("Neo4j error");
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });

  it("should throw on invalid edge type", async () => {
    await expect(
      expandNode("node-a", { edgeTypes: ["INVALID_TYPE" as never] }),
    ).rejects.toThrow("Invalid edge type");
  });
});

describe("expandResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionRun.mockResolvedValue({ records: [] });
  });

  it("should expand all search result nodes and merge", async () => {
    // First call: expand node-a → finds node-b
    // Second call: expand node-c → finds node-b (duplicate)
    mockSessionRun
      .mockResolvedValueOnce({
        records: [
          makeNeo4jRecord({ neighbor: makeNeo4jNode(NODE_B), rels: [EDGE_AB] }),
        ],
      })
      .mockResolvedValueOnce({
        records: [
          makeNeo4jRecord({ neighbor: makeNeo4jNode(NODE_B), rels: [EDGE_BC] }),
        ],
      });

    const searchResults: SearchResult[] = [
      { node: { id: "node-a", kind: "native", category: "insight", title: "", content: "", tags: [], embedding: [], createdAt: "", updatedAt: "", workspaceId: "" }, score: 0.9, edges: [] },
      { node: { id: "node-c", kind: "native", category: "decision", title: "", content: "", tags: [], embedding: [], createdAt: "", updatedAt: "", workspaceId: "" }, score: 0.8, edges: [] },
    ];

    const result = await expandResults(searchResults);
    // node-b found from both starts, but deduplicated
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe("node-b");
    // Two distinct edges
    expect(result.edges).toHaveLength(2);
  });

  it("should exclude original search result nodes from neighbors", async () => {
    // Expanding node-a finds node-b
    mockSessionRun.mockResolvedValue({
      records: [
        makeNeo4jRecord({ neighbor: makeNeo4jNode(NODE_A), rels: [EDGE_AB] }),
        makeNeo4jRecord({ neighbor: makeNeo4jNode(NODE_B), rels: [EDGE_AB] }),
      ],
    });

    const searchResults: SearchResult[] = [
      { node: { id: "node-a", kind: "native", category: "insight", title: "", content: "", tags: [], embedding: [], createdAt: "", updatedAt: "", workspaceId: "" }, score: 0.9, edges: [] },
    ];

    const result = await expandResults(searchResults);
    // node-a is the start node, should be excluded
    expect(result.nodes.find((n) => n.id === "node-a")).toBeUndefined();
    expect(result.nodes.find((n) => n.id === "node-b")).toBeDefined();
  });

  it("should return empty result for empty search results", async () => {
    const result = await expandResults([]);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(mockSessionRun).not.toHaveBeenCalled();
  });
});
