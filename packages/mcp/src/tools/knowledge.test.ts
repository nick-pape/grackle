import { describe, it, expect, vi, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";
import type { AuthContext } from "../auth-context.js";
import { knowledgeTools } from "./knowledge.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findTool(name: string) {
  return knowledgeTools.find((t) => t.name === name)!;
}

function makeProtoNode(overrides: Partial<grackle.KnowledgeNodeProto> = {}): grackle.KnowledgeNodeProto {
  return create(grackle.KnowledgeNodeProtoSchema, {
    id: "node-1",
    kind: "native",
    workspaceId: "ws-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    category: "insight",
    title: "Test Node",
    content: "Test content",
    tags: ["test"],
    ...overrides,
  });
}

function makeProtoEdge(overrides: Partial<grackle.KnowledgeEdgeProto> = {}): grackle.KnowledgeEdgeProto {
  return create(grackle.KnowledgeEdgeProtoSchema, {
    fromId: "node-1",
    toId: "node-2",
    type: "RELATES_TO",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });
}

/** Create a mock gRPC client with all knowledge methods. */
function createMockClient() {
  return {
    searchKnowledge: vi.fn().mockResolvedValue(
      create(grackle.SearchKnowledgeResponseSchema, { results: [] }),
    ),
    getKnowledgeNode: vi.fn().mockResolvedValue(
      create(grackle.GetKnowledgeNodeResponseSchema, {}),
    ),
    expandKnowledgeNode: vi.fn().mockResolvedValue(
      create(grackle.ExpandKnowledgeNodeResponseSchema, { nodes: [], edges: [] }),
    ),
    createKnowledgeNode: vi.fn().mockResolvedValue(
      create(grackle.CreateKnowledgeNodeResponseSchema, { id: "new-id" }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("knowledge_search", () => {
  const tool = findTool("knowledge_search");
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should call searchKnowledge gRPC with query and limit", async () => {
    await tool.handler({ query: "auth", limit: 5, workspaceId: "ws-1" }, client as never);

    expect(client.searchKnowledge).toHaveBeenCalledWith({
      query: "auth",
      limit: 5,
      workspaceId: "ws-1",
    });
  });

  it("should format results with scores and nodes", async () => {
    client.searchKnowledge.mockResolvedValue(
      create(grackle.SearchKnowledgeResponseSchema, {
        results: [
          create(grackle.SearchKnowledgeResultSchema, {
            score: 0.8567,
            node: makeProtoNode(),
            edges: [makeProtoEdge()],
          }),
        ],
      }),
    );

    const result = await tool.handler({ query: "test" }, client as never);
    const content = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(content.results).toHaveLength(1);
    expect(content.results[0].score).toBe(0.857);
    expect(content.results[0].node.id).toBe("node-1");
    expect(content.results[0].edges).toHaveLength(1);
  });

  it("should expand results when expand=true", async () => {
    client.searchKnowledge.mockResolvedValue(
      create(grackle.SearchKnowledgeResponseSchema, {
        results: [
          create(grackle.SearchKnowledgeResultSchema, {
            score: 0.9,
            node: makeProtoNode({ id: "node-1" }),
            edges: [],
          }),
        ],
      }),
    );
    client.expandKnowledgeNode.mockResolvedValue(
      create(grackle.ExpandKnowledgeNodeResponseSchema, {
        nodes: [makeProtoNode({ id: "node-2", title: "Neighbor" })],
        edges: [makeProtoEdge()],
      }),
    );

    const result = await tool.handler(
      { query: "test", expand: true, expandDepth: 2 },
      client as never,
    );
    expect(client.expandKnowledgeNode).toHaveBeenCalledWith({
      id: "node-1",
      depth: 2,
    });

    const content = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(content.neighbors).toHaveLength(1);
    expect(content.neighborEdges).toHaveLength(1);
  });
});

describe("knowledge_get_node", () => {
  const tool = findTool("knowledge_get_node");
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should call getKnowledgeNode gRPC", async () => {
    client.getKnowledgeNode.mockResolvedValue(
      create(grackle.GetKnowledgeNodeResponseSchema, {
        node: makeProtoNode(),
        edges: [makeProtoEdge()],
      }),
    );

    const result = await tool.handler({ id: "node-1" }, client as never);
    expect(client.getKnowledgeNode).toHaveBeenCalledWith({ id: "node-1" });

    const content = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(content.node.id).toBe("node-1");
    expect(content.edges).toHaveLength(1);
  });

  it("should return error when node not found", async () => {
    client.getKnowledgeNode.mockResolvedValue(
      create(grackle.GetKnowledgeNodeResponseSchema, {}),
    );

    const result = await tool.handler({ id: "missing" }, client as never);
    expect((result as { isError: boolean }).isError).toBe(true);
  });

  it("should expand when expand=true", async () => {
    client.getKnowledgeNode.mockResolvedValue(
      create(grackle.GetKnowledgeNodeResponseSchema, {
        node: makeProtoNode(),
        edges: [],
      }),
    );

    await tool.handler({ id: "node-1", expand: true, expandDepth: 1 }, client as never);
    expect(client.expandKnowledgeNode).toHaveBeenCalledWith({
      id: "node-1",
      depth: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Auth context helpers
// ---------------------------------------------------------------------------

const SCOPED_AUTH: AuthContext = {
  type: "scoped",
  taskId: "t1",
  workspaceId: "ws-1",
  personaId: "p1",
  taskSessionId: "s1",
};

// ---------------------------------------------------------------------------
// Workspace scoping tests
// ---------------------------------------------------------------------------

describe("knowledge_search — workspace scoping", () => {
  const tool = findTool("knowledge_search");
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should override user-supplied workspaceId for scoped callers", async () => {
    await tool.handler(
      { query: "test", workspaceId: "ws-other" },
      client as never,
      SCOPED_AUTH,
    );

    expect(client.searchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1" }),
    );
  });

  it("should allow user-supplied workspaceId for api-key callers", async () => {
    await tool.handler(
      { query: "test", workspaceId: "ws-other" },
      client as never,
      { type: "api-key" },
    );

    expect(client.searchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-other" }),
    );
  });

  it("should filter expanded neighbors to the scoped workspace", async () => {
    client.searchKnowledge.mockResolvedValue(
      create(grackle.SearchKnowledgeResponseSchema, {
        results: [
          create(grackle.SearchKnowledgeResultSchema, {
            score: 0.9,
            node: makeProtoNode({ id: "node-1", workspaceId: "ws-1" }),
            edges: [],
          }),
        ],
      }),
    );
    client.expandKnowledgeNode.mockResolvedValue(
      create(grackle.ExpandKnowledgeNodeResponseSchema, {
        nodes: [
          makeProtoNode({ id: "node-2", workspaceId: "ws-1", title: "Same WS" }),
          makeProtoNode({ id: "node-3", workspaceId: "ws-other", title: "Other WS" }),
        ],
        edges: [
          makeProtoEdge({ fromId: "node-1", toId: "node-2" }),
          makeProtoEdge({ fromId: "node-1", toId: "node-3" }),
        ],
      }),
    );

    const result = await tool.handler(
      { query: "test", expand: true },
      client as never,
      SCOPED_AUTH,
    );
    const content = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

    expect(content.neighbors).toHaveLength(1);
    expect(content.neighbors[0].id).toBe("node-2");
  });
});

describe("knowledge_get_node — workspace scoping", () => {
  const tool = findTool("knowledge_get_node");
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should deny access to nodes outside the scoped workspace", async () => {
    client.getKnowledgeNode.mockResolvedValue(
      create(grackle.GetKnowledgeNodeResponseSchema, {
        node: makeProtoNode({ id: "node-1", workspaceId: "ws-other" }),
        edges: [],
      }),
    );

    const result = await tool.handler({ id: "node-1" }, client as never, SCOPED_AUTH);
    expect((result as { isError: boolean }).isError).toBe(true);
    const content = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(content.error).toContain("Node not found");
  });

  it("should allow access to nodes in the scoped workspace", async () => {
    client.getKnowledgeNode.mockResolvedValue(
      create(grackle.GetKnowledgeNodeResponseSchema, {
        node: makeProtoNode({ id: "node-1", workspaceId: "ws-1" }),
        edges: [],
      }),
    );

    const result = await tool.handler({ id: "node-1" }, client as never, SCOPED_AUTH);
    expect((result as { isError?: boolean }).isError).toBeUndefined();
  });

  it("should allow api-key callers to access any workspace", async () => {
    client.getKnowledgeNode.mockResolvedValue(
      create(grackle.GetKnowledgeNodeResponseSchema, {
        node: makeProtoNode({ id: "node-1", workspaceId: "ws-other" }),
        edges: [],
      }),
    );

    const result = await tool.handler({ id: "node-1" }, client as never, { type: "api-key" });
    expect((result as { isError?: boolean }).isError).toBeUndefined();
  });

  it("should filter expanded neighbors to the scoped workspace", async () => {
    client.getKnowledgeNode.mockResolvedValue(
      create(grackle.GetKnowledgeNodeResponseSchema, {
        node: makeProtoNode({ id: "node-1", workspaceId: "ws-1" }),
        edges: [],
      }),
    );
    client.expandKnowledgeNode.mockResolvedValue(
      create(grackle.ExpandKnowledgeNodeResponseSchema, {
        nodes: [
          makeProtoNode({ id: "node-2", workspaceId: "ws-1" }),
          makeProtoNode({ id: "node-3", workspaceId: "ws-other" }),
        ],
        edges: [
          makeProtoEdge({ fromId: "node-1", toId: "node-2" }),
          makeProtoEdge({ fromId: "node-1", toId: "node-3" }),
        ],
      }),
    );

    const result = await tool.handler(
      { id: "node-1", expand: true },
      client as never,
      SCOPED_AUTH,
    );
    const content = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);

    expect(content.neighbors).toHaveLength(1);
    expect(content.neighbors[0].id).toBe("node-2");
    expect(content.neighborEdges).toHaveLength(1);
    expect(content.neighborEdges[0].toId).toBe("node-2");
  });
});

describe("knowledge_create_node", () => {
  const tool = findTool("knowledge_create_node");
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  it("should call createKnowledgeNode gRPC", async () => {
    const result = await tool.handler(
      { title: "Test", content: "Content", category: "decision", tags: ["a"] },
      client as never,
    );

    expect(client.createKnowledgeNode).toHaveBeenCalledWith({
      title: "Test",
      content: "Content",
      category: "decision",
      tags: ["a"],
      workspaceId: "",
    });

    const content = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
    expect(content.id).toBe("new-id");
    expect(content.category).toBe("decision");
  });

  it("should use scoped workspace from auth context", async () => {
    await tool.handler(
      { title: "Test", content: "Content" },
      client as never,
      { type: "scoped", workspaceId: "ws-scoped", taskId: "t1", taskSessionId: "s1" },
    );

    expect(client.createKnowledgeNode).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-scoped" }),
    );
  });

  it("should default category to insight", async () => {
    await tool.handler(
      { title: "Test", content: "Content" },
      client as never,
    );

    expect(client.createKnowledgeNode).toHaveBeenCalledWith(
      expect.objectContaining({ category: "insight" }),
    );
  });
});
