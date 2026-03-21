import { describe, it, expect, vi } from "vitest";

// Mock neo4j-driver so the client module can be imported without a real Neo4j
vi.mock("neo4j-driver", () => ({
  default: {
    driver: vi.fn(),
    auth: { basic: vi.fn() },
  },
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("@grackle-ai/knowledge", () => {
  it("should export the expected public API", async () => {
    const mod = await import("./index.js");
    expect(mod.createLocalEmbedder).toBeTypeOf("function");
    expect(mod.createPassThroughChunker).toBeTypeOf("function");
    expect(mod.createTranscriptChunker).toBeTypeOf("function");
    expect(mod.ingest).toBeTypeOf("function");
  });

  it("exports client functions", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.openNeo4j).toBe("function");
    expect(typeof mod.closeNeo4j).toBe("function");
    expect(typeof mod.healthCheck).toBe("function");
    expect(typeof mod.getSession).toBe("function");
    expect(typeof mod.getDriver).toBe("function");
  });

  it("exports schema functions", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.initSchema).toBe("function");
    expect(mod.SCHEMA_STATEMENTS).toBeDefined();
  });

  it("exports type constants", async () => {
    const mod = await import("./index.js");
    expect(mod.NODE_KIND).toBeDefined();
    expect(mod.REFERENCE_SOURCE).toBeDefined();
    expect(mod.NATIVE_CATEGORY).toBeDefined();
    expect(mod.EDGE_TYPE).toBeDefined();
  });

  it("exports type guards", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.isReferenceNode).toBe("function");
    expect(typeof mod.isNativeNode).toBe("function");
  });

  it("exports Neo4j constants", async () => {
    const mod = await import("./index.js");
    expect(mod.DEFAULT_NEO4J_URL).toBe("bolt://127.0.0.1:7687");
    expect(mod.NODE_LABEL).toBe("KnowledgeNode");
    expect(mod.VECTOR_INDEX_NAME).toBe("knowledge_embedding_index");
    expect(mod.EMBEDDING_DIMENSIONS).toBe(1536);
  });

  it("exports node store functions", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.createReferenceNode).toBe("function");
    expect(typeof mod.createNativeNode).toBe("function");
    expect(typeof mod.getNode).toBe("function");
    expect(typeof mod.deleteNode).toBe("function");
    expect(typeof mod.updateNode).toBe("function");
    expect(typeof mod.recordToNode).toBe("function");
  });

  it("exports edge store functions", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.createEdge).toBe("function");
    expect(typeof mod.removeEdge).toBe("function");
  });

  it("exports search functions", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.knowledgeSearch).toBe("function");
  });
});
