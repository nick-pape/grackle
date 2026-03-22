import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockKnowledgeSearch,
  mockGetNode,
  mockCreateNativeNode,
  mockCreateEdge,
  mockExpandNode,
  mockExpandResults,
  mockEmbed,
} = vi.hoisted(() => ({
  mockKnowledgeSearch: vi.fn().mockResolvedValue([]),
  mockGetNode: vi.fn().mockResolvedValue(undefined),
  mockCreateNativeNode: vi.fn().mockResolvedValue("new-node-id"),
  mockCreateEdge: vi.fn().mockResolvedValue({ fromId: "a", toId: "b", type: "RELATES_TO", createdAt: "" }),
  mockExpandNode: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  mockExpandResults: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  mockEmbed: vi.fn().mockResolvedValue({ text: "test", vector: [0.1, 0.2] }),
}));

vi.mock("@grackle-ai/knowledge", () => ({
  knowledgeSearch: mockKnowledgeSearch,
  getNode: mockGetNode,
  createNativeNode: mockCreateNativeNode,
  createEdge: mockCreateEdge,
  expandNode: mockExpandNode,
  expandResults: mockExpandResults,
  NATIVE_CATEGORY: {
    DECISION: "decision",
    INSIGHT: "insight",
    CONCEPT: "concept",
    SNIPPET: "snippet",
  },
  EDGE_TYPE: {
    RELATES_TO: "RELATES_TO",
    DEPENDS_ON: "DEPENDS_ON",
    DERIVED_FROM: "DERIVED_FROM",
    MENTIONS: "MENTIONS",
    PART_OF: "PART_OF",
  },
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { knowledgeTools, setKnowledgeEmbedder } from "./knowledge.js";
import type { Embedder } from "@grackle-ai/knowledge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findTool(name: string) {
  const tool = knowledgeTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }
  return tool;
}

const MOCK_CLIENT = {} as Parameters<typeof knowledgeTools[0]["handler"]>[1];

function createMockEmbedder(): Embedder {
  return {
    dimensions: 384,
    embed: mockEmbed,
    embedBatch: vi.fn().mockResolvedValue([]),
  };
}

const SAMPLE_NODE = {
  id: "node-1",
  kind: "native" as const,
  category: "insight",
  title: "Test insight",
  content: "Some content",
  tags: ["test"],
  embedding: [0.1, 0.2],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  workspaceId: "ws-1",
};

const SAMPLE_EDGE = {
  fromId: "node-1",
  toId: "node-2",
  type: "RELATES_TO" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("knowledge tools", () => {
  beforeEach(() => {
    mockKnowledgeSearch.mockClear();
    mockGetNode.mockClear();
    mockCreateNativeNode.mockClear();
    mockCreateEdge.mockClear();
    mockExpandNode.mockClear();
    mockExpandResults.mockClear();
    mockEmbed.mockClear();

    setKnowledgeEmbedder(createMockEmbedder());
  });

  it("registers 3 tools", () => {
    expect(knowledgeTools).toHaveLength(3);
    expect(knowledgeTools.map((t) => t.name).sort()).toEqual([
      "knowledge_create_node",
      "knowledge_get_node",
      "knowledge_search",
    ]);
  });

  it("all tools are in the knowledge group", () => {
    for (const tool of knowledgeTools) {
      expect(tool.group).toBe("knowledge");
    }
  });
});

describe("knowledge_search", () => {
  const tool = findTool("knowledge_search");

  beforeEach(() => {
    mockKnowledgeSearch.mockClear();
    mockExpandResults.mockClear();
    mockEmbed.mockClear();
    setKnowledgeEmbedder(createMockEmbedder());
  });

  it("returns search results", async () => {
    mockKnowledgeSearch.mockResolvedValueOnce([
      { node: SAMPLE_NODE, score: 0.95, edges: [SAMPLE_EDGE] },
    ]);

    const result = await tool.handler(
      { query: "test query" },
      MOCK_CLIENT,
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].score).toBe(0.95);
    expect(data.results[0].node.title).toBe("Test insight");
    expect(data.results[0].node.embedding).toBeUndefined();
  });

  it("does not include embedding vectors in results", async () => {
    mockKnowledgeSearch.mockResolvedValueOnce([
      { node: SAMPLE_NODE, score: 0.9, edges: [] },
    ]);

    const result = await tool.handler({ query: "test" }, MOCK_CLIENT);
    const data = JSON.parse(result.content[0].text);
    expect(data.results[0].node.embedding).toBeUndefined();
  });

  it("handles empty results", async () => {
    mockKnowledgeSearch.mockResolvedValueOnce([]);

    const result = await tool.handler({ query: "nothing" }, MOCK_CLIENT);
    const data = JSON.parse(result.content[0].text);
    expect(data.results).toEqual([]);
  });

  it("passes options to knowledgeSearch", async () => {
    mockKnowledgeSearch.mockResolvedValueOnce([]);

    await tool.handler(
      { query: "test", limit: 5, workspaceId: "ws-1" },
      MOCK_CLIENT,
    );

    expect(mockKnowledgeSearch).toHaveBeenCalledWith(
      "test",
      expect.anything(),
      { limit: 5, workspaceId: "ws-1" },
    );
  });

  it("expands results when expand=true", async () => {
    mockKnowledgeSearch.mockResolvedValueOnce([
      { node: SAMPLE_NODE, score: 0.9, edges: [] },
    ]);
    mockExpandResults.mockResolvedValueOnce({
      nodes: [{ ...SAMPLE_NODE, id: "neighbor-1", title: "Neighbor" }],
      edges: [],
    });

    const result = await tool.handler(
      { query: "test", expand: true },
      MOCK_CLIENT,
    );

    expect(mockExpandResults).toHaveBeenCalled();
    const data = JSON.parse(result.content[0].text);
    expect(data.neighbors).toHaveLength(1);
  });

  it("returns error when embedder not initialized", async () => {
    setKnowledgeEmbedder(undefined);

    const result = await tool.handler({ query: "test" }, MOCK_CLIENT);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain("not available");
  });
});

describe("knowledge_get_node", () => {
  const tool = findTool("knowledge_get_node");

  beforeEach(() => {
    mockGetNode.mockClear();
    mockExpandNode.mockClear();
  });

  it("returns node with edges", async () => {
    mockGetNode.mockResolvedValueOnce({
      node: SAMPLE_NODE,
      edges: [SAMPLE_EDGE],
    });

    const result = await tool.handler({ id: "node-1" }, MOCK_CLIENT);

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.node.id).toBe("node-1");
    expect(data.node.title).toBe("Test insight");
    expect(data.edges).toHaveLength(1);
  });

  it("returns error when node not found", async () => {
    mockGetNode.mockResolvedValueOnce(undefined);

    const result = await tool.handler({ id: "missing" }, MOCK_CLIENT);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain("not found");
  });

  it("expands when requested", async () => {
    mockGetNode.mockResolvedValueOnce({
      node: SAMPLE_NODE,
      edges: [],
    });
    mockExpandNode.mockResolvedValueOnce({
      nodes: [{ ...SAMPLE_NODE, id: "n2" }],
      edges: [SAMPLE_EDGE],
    });

    const result = await tool.handler(
      { id: "node-1", expand: true, expandDepth: 2 },
      MOCK_CLIENT,
    );

    expect(mockExpandNode).toHaveBeenCalledWith("node-1", { depth: 2 });
    const data = JSON.parse(result.content[0].text);
    expect(data.neighbors).toHaveLength(1);
  });
});

describe("knowledge_create_node", () => {
  const tool = findTool("knowledge_create_node");

  beforeEach(() => {
    mockCreateNativeNode.mockClear();
    mockCreateEdge.mockClear();
    mockEmbed.mockClear();
    setKnowledgeEmbedder(createMockEmbedder());
    mockCreateNativeNode.mockResolvedValue("new-node-id");
  });

  it("creates a node and returns its ID", async () => {
    const result = await tool.handler(
      { title: "My insight", content: "Some content" },
      MOCK_CLIENT,
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe("new-node-id");
    expect(data.title).toBe("My insight");
    expect(data.category).toBe("insight");

    expect(mockEmbed).toHaveBeenCalledWith("My insight Some content");
    expect(mockCreateNativeNode).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "My insight",
        content: "Some content",
        category: "insight",
        embedding: [0.1, 0.2],
      }),
    );
  });

  it("uses provided category", async () => {
    await tool.handler(
      { title: "Decision", content: "We chose X", category: "decision" },
      MOCK_CLIENT,
    );

    expect(mockCreateNativeNode).toHaveBeenCalledWith(
      expect.objectContaining({ category: "decision" }),
    );
  });

  it("creates edges when provided", async () => {
    const result = await tool.handler(
      {
        title: "Insight",
        content: "Content",
        edges: [
          { toId: "other-1", type: "RELATES_TO" },
          { toId: "other-2", type: "DEPENDS_ON" },
        ],
      },
      MOCK_CLIENT,
    );

    expect(mockCreateEdge).toHaveBeenCalledTimes(2);
    const data = JSON.parse(result.content[0].text);
    expect(data.edges).toHaveLength(2);
  });

  it("uses scoped workspaceId from auth context", async () => {
    await tool.handler(
      { title: "T", content: "C" },
      MOCK_CLIENT,
      { type: "scoped", taskId: "t1", workspaceId: "ws-scoped", personaId: "p", taskSessionId: "s" },
    );

    expect(mockCreateNativeNode).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-scoped" }),
    );
  });

  it("scoped callers always use auth context workspace (ignores explicit)", async () => {
    await tool.handler(
      { title: "T", content: "C", workspaceId: "ws-explicit" },
      MOCK_CLIENT,
      { type: "scoped", taskId: "t1", workspaceId: "ws-scoped", personaId: "p", taskSessionId: "s" },
    );

    expect(mockCreateNativeNode).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-scoped" }),
    );
  });

  it("returns error when embedder not initialized", async () => {
    setKnowledgeEmbedder(undefined);

    const result = await tool.handler(
      { title: "T", content: "C" },
      MOCK_CLIENT,
    );
    expect(result.isError).toBe(true);
  });
});
