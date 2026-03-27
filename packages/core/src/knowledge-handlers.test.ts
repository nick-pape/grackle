import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { grackle } from "@grackle-ai/common";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockKnowledgeSearch,
  mockGetNode,
  mockExpandNode,
  mockCreateNativeNode,
  mockIngest,
  mockCreatePassThroughChunker,
  mockListRecentNodes,
  mockGetKnowledgeEmbedder,
  mockIsKnowledgeEnabled,
  mockIsNeo4jHealthy,
} = vi.hoisted(() => ({
  mockKnowledgeSearch: vi.fn().mockResolvedValue([]),
  mockGetNode: vi.fn(),
  mockExpandNode: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  mockCreateNativeNode: vi.fn().mockResolvedValue("new-node-id"),
  mockIngest: vi.fn().mockResolvedValue([{ vector: [0.1, 0.2] }]),
  mockCreatePassThroughChunker: vi.fn().mockReturnValue({}),
  mockListRecentNodes: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  mockGetKnowledgeEmbedder: vi.fn().mockReturnValue({ dimensions: 384, embed: vi.fn() }),
  mockIsKnowledgeEnabled: vi.fn().mockReturnValue(true),
  mockIsNeo4jHealthy: vi.fn().mockReturnValue(true),
}));

vi.mock("@grackle-ai/knowledge", () => ({
  knowledgeSearch: mockKnowledgeSearch,
  getNode: mockGetNode,
  expandNode: mockExpandNode,
  createNativeNode: mockCreateNativeNode,
  ingest: mockIngest,
  createPassThroughChunker: mockCreatePassThroughChunker,
  listRecentNodes: mockListRecentNodes,
}));

vi.mock("./knowledge-init.js", () => ({
  getKnowledgeEmbedder: mockGetKnowledgeEmbedder,
  isKnowledgeEnabled: mockIsKnowledgeEnabled,
}));

vi.mock("./knowledge-health.js", () => ({
  isNeo4jHealthy: mockIsNeo4jHealthy,
}));

vi.mock("./grpc-proto-converters.js", () => ({
  knowledgeNodeToProto: vi.fn((node: unknown) => node),
  knowledgeEdgeToProto: vi.fn((edge: unknown) => edge),
}));

import {
  searchKnowledge,
  getKnowledgeNode,
  expandKnowledgeNode,
  listRecentKnowledgeNodes,
  createKnowledgeNode,
} from "./knowledge-handlers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearchRequest(query: string = "test"): grackle.SearchKnowledgeRequest {
  return create(grackle.SearchKnowledgeRequestSchema, { query });
}

function makeGetNodeRequest(id: string = "node-1"): grackle.GetKnowledgeNodeRequest {
  return create(grackle.GetKnowledgeNodeRequestSchema, { id });
}

function makeExpandRequest(id: string = "node-1"): grackle.ExpandKnowledgeNodeRequest {
  return create(grackle.ExpandKnowledgeNodeRequestSchema, { id });
}

function makeListRecentRequest(): grackle.ListRecentKnowledgeNodesRequest {
  return create(grackle.ListRecentKnowledgeNodesRequestSchema, {});
}

function makeCreateRequest(): grackle.CreateKnowledgeNodeRequest {
  return create(grackle.CreateKnowledgeNodeRequestSchema, {
    title: "Test",
    content: "Test content",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("knowledge handler health gate", () => {
  beforeEach(() => {
    mockIsNeo4jHealthy.mockReturnValue(false);
    mockGetKnowledgeEmbedder.mockReturnValue({ dimensions: 384, embed: vi.fn() });
    mockIsKnowledgeEnabled.mockReturnValue(true);
  });

  it("searchKnowledge throws Unavailable when Neo4j is unhealthy", async () => {
    await expect(searchKnowledge(makeSearchRequest())).rejects.toThrow(ConnectError);
    try {
      await searchKnowledge(makeSearchRequest());
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe(Code.Unavailable);
      expect((err as ConnectError).message).toContain("Neo4j");
    }
  });

  it("getKnowledgeNode throws Unavailable when Neo4j is unhealthy", async () => {
    await expect(getKnowledgeNode(makeGetNodeRequest())).rejects.toThrow(ConnectError);
    try {
      await getKnowledgeNode(makeGetNodeRequest());
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.Unavailable);
    }
  });

  it("expandKnowledgeNode throws Unavailable when Neo4j is unhealthy", async () => {
    await expect(expandKnowledgeNode(makeExpandRequest())).rejects.toThrow(ConnectError);
    try {
      await expandKnowledgeNode(makeExpandRequest());
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.Unavailable);
    }
  });

  it("listRecentKnowledgeNodes throws Unavailable when Neo4j is unhealthy", async () => {
    await expect(listRecentKnowledgeNodes(makeListRecentRequest())).rejects.toThrow(ConnectError);
    try {
      await listRecentKnowledgeNodes(makeListRecentRequest());
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.Unavailable);
    }
  });

  it("createKnowledgeNode throws Unavailable when Neo4j is unhealthy", async () => {
    await expect(createKnowledgeNode(makeCreateRequest())).rejects.toThrow(ConnectError);
    try {
      await createKnowledgeNode(makeCreateRequest());
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.Unavailable);
    }
  });

  it("does NOT call the underlying knowledge function when Neo4j is unhealthy", async () => {
    mockKnowledgeSearch.mockClear();
    await searchKnowledge(makeSearchRequest()).catch(() => {});
    expect(mockKnowledgeSearch).not.toHaveBeenCalled();
  });
});

describe("knowledge handler Neo4j error wrapping", () => {
  beforeEach(() => {
    mockIsNeo4jHealthy.mockReturnValue(true);
    mockGetKnowledgeEmbedder.mockReturnValue({ dimensions: 384, embed: vi.fn() });
    mockIsKnowledgeEnabled.mockReturnValue(true);
  });

  it("wraps unexpected errors from knowledgeSearch as Unavailable", async () => {
    mockKnowledgeSearch.mockRejectedValueOnce(new Error("Connection refused"));

    try {
      await searchKnowledge(makeSearchRequest());
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe(Code.Unavailable);
      expect((err as ConnectError).message).toContain("Neo4j");
    }
  });

  it("wraps unexpected errors from getNode as Unavailable", async () => {
    mockGetNode.mockRejectedValueOnce(new Error("Socket closed"));

    try {
      await getKnowledgeNode(makeGetNodeRequest());
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe(Code.Unavailable);
    }
  });

  it("preserves existing ConnectErrors (e.g. NotFound)", async () => {
    mockGetNode.mockResolvedValueOnce(undefined);

    try {
      await getKnowledgeNode(makeGetNodeRequest());
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      // NotFound, not Unavailable — the handler's own ConnectError is preserved
      expect((err as ConnectError).code).toBe(Code.NotFound);
    }
  });

  it("wraps unexpected errors from expandNode as Unavailable", async () => {
    mockExpandNode.mockRejectedValueOnce(new Error("timeout"));

    try {
      await expandKnowledgeNode(makeExpandRequest());
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe(Code.Unavailable);
    }
  });

  it("wraps unexpected errors from createNativeNode as Unavailable", async () => {
    mockCreateNativeNode.mockRejectedValueOnce(new Error("write failed"));

    try {
      await createKnowledgeNode(makeCreateRequest());
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe(Code.Unavailable);
    }
  });
});
