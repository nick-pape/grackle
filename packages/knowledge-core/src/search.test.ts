import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Embedder, EmbeddingResult } from "./embedder.js";

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

import { knowledgeSearch } from "./search.js";
import type { SearchOptions } from "./search.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNeo4jRecord(data: Record<string, unknown>) {
  return { get: (key: string) => data[key] };
}

function makeNeo4jNode(properties: Record<string, unknown>) {
  return { properties };
}

function createMockEmbedder(): Embedder {
  return {
    dimensions: 4,
    async embed(text: string): Promise<EmbeddingResult> {
      return { text, vector: [0.1, 0.2, 0.3, 0.4] };
    },
    async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
      return texts.map((text) => ({ text, vector: [0.1, 0.2, 0.3, 0.4] }));
    },
  };
}

const NATIVE_NODE_PROPS: Record<string, unknown> = {
  id: "node-1",
  kind: "native",
  category: "insight",
  title: "WebSocket reconnection",
  content: "Uses exponential backoff with jitter",
  tags: ["websocket", "networking"],
  embedding: [0.1, 0.2, 0.3, 0.4],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  workspaceId: "ws-1",
};

const REFERENCE_NODE_PROPS: Record<string, unknown> = {
  id: "node-2",
  kind: "reference",
  sourceType: "task",
  sourceId: "task-42",
  label: "Fix auth middleware",
  embedding: [0.5, 0.6, 0.7, 0.8],
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  workspaceId: "ws-1",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("knowledgeSearch", () => {
  const embedder: Embedder = createMockEmbedder();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionRun.mockResolvedValue({ records: [] });
  });

  it("should embed the query and run a Cypher vector search", async () => {
    await knowledgeSearch("websocket reconnection", embedder);

    expect(mockSessionRun).toHaveBeenCalledTimes(1);
    const [cypher, params] = mockSessionRun.mock.calls[0];
    expect(cypher).toContain("db.index.vector.queryNodes");
    expect(params.queryVector).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("should return results sorted by score with node and edges", async () => {
    mockSessionRun.mockResolvedValue({
      records: [
        makeNeo4jRecord({
          node: makeNeo4jNode(NATIVE_NODE_PROPS),
          score: 0.95,
          edges: [
            { fromId: "node-1", toId: "node-2", type: "RELATES_TO", metadata: null, createdAt: "2026-01-01T00:00:00.000Z" },
          ],
        }),
        makeNeo4jRecord({
          node: makeNeo4jNode(REFERENCE_NODE_PROPS),
          score: 0.82,
          edges: [],
        }),
      ],
    });

    const results = await knowledgeSearch("auth", embedder);
    expect(results).toHaveLength(2);

    // Verify Cypher includes ORDER BY score DESC
    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).toContain("ORDER BY score DESC");

    expect(results[0].score).toBe(0.95);
    expect(results[0].node.id).toBe("node-1");
    expect(results[0].edges).toHaveLength(1);
    expect(results[0].edges[0].type).toBe("RELATES_TO");

    expect(results[1].score).toBe(0.82);
    expect(results[1].node.id).toBe("node-2");
    expect(results[1].edges).toHaveLength(0);
  });

  it("should use default limit of 10", async () => {
    await knowledgeSearch("query", embedder);

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).toContain("LIMIT 10");
  });

  it("should respect custom limit", async () => {
    await knowledgeSearch("query", embedder, { limit: 5 });

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).toContain("LIMIT 5");
  });

  it("should pass minScore to the query", async () => {
    await knowledgeSearch("query", embedder, { minScore: 0.8 });

    const params = mockSessionRun.mock.calls[0][1] as Record<string, unknown>;
    expect(params.minScore).toBe(0.8);
  });

  it("should filter by nodeKinds when provided", async () => {
    await knowledgeSearch("query", embedder, { nodeKinds: ["native"] });

    const [cypher, params] = mockSessionRun.mock.calls[0];
    expect(cypher).toContain("node.kind IN $nodeKinds");
    expect((params as Record<string, unknown>).nodeKinds).toEqual(["native"]);
  });

  it("should not include nodeKinds filter when not provided", async () => {
    await knowledgeSearch("query", embedder);

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).not.toContain("node.kind IN");
  });

  it("should filter by workspaceId when provided", async () => {
    await knowledgeSearch("query", embedder, { workspaceId: "ws-1" });

    const [cypher, params] = mockSessionRun.mock.calls[0];
    expect(cypher).toContain("node.workspaceId = $workspaceId");
    expect((params as Record<string, unknown>).workspaceId).toBe("ws-1");
  });

  it("should return empty array when no results match", async () => {
    mockSessionRun.mockResolvedValue({ records: [] });
    const results = await knowledgeSearch("nonexistent topic", embedder);
    expect(results).toEqual([]);
  });

  it("should filter out null edges from OPTIONAL MATCH", async () => {
    mockSessionRun.mockResolvedValue({
      records: [
        makeNeo4jRecord({
          node: makeNeo4jNode(NATIVE_NODE_PROPS),
          score: 0.9,
          edges: [
            { fromId: null, toId: null, type: null, metadata: null, createdAt: null },
          ],
        }),
      ],
    });

    const results = await knowledgeSearch("test", embedder);
    expect(results[0].edges).toHaveLength(0);
  });

  it("should over-fetch candidates when filters are applied", async () => {
    await knowledgeSearch("query", embedder, { limit: 5, nodeKinds: ["native"] });

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).toContain("queryNodes($indexName, 15,"); // 5 * 3
  });

  it("should not over-fetch when no filters", async () => {
    await knowledgeSearch("query", embedder, { limit: 5 });

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).toContain("queryNodes($indexName, 5,");
  });

  it("should always close the session", async () => {
    mockSessionRun.mockRejectedValue(new Error("Neo4j error"));

    await expect(knowledgeSearch("query", embedder)).rejects.toThrow("Neo4j error");
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });
});
