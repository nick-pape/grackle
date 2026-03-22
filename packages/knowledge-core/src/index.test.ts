import { describe, it, expect, vi } from "vitest";

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

describe("@grackle-ai/knowledge-core", () => {
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

  it("exports node and edge store functions", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.createReferenceNode).toBe("function");
    expect(typeof mod.createNativeNode).toBe("function");
    expect(typeof mod.getNode).toBe("function");
    expect(typeof mod.deleteNode).toBe("function");
    expect(typeof mod.updateNode).toBe("function");
    expect(typeof mod.createEdge).toBe("function");
    expect(typeof mod.removeEdge).toBe("function");
  });

  it("exports search and expansion functions", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.knowledgeSearch).toBe("function");
    expect(typeof mod.expandNode).toBe("function");
    expect(typeof mod.expandResults).toBe("function");
  });

  it("exports embedder and chunker factories", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.createLocalEmbedder).toBe("function");
    expect(typeof mod.createPassThroughChunker).toBe("function");
    expect(typeof mod.createTranscriptChunker).toBe("function");
    expect(typeof mod.ingest).toBe("function");
  });

  it("has open string types for ReferenceSource and NativeCategory", async () => {
    const mod = await import("./index.js");
    // REFERENCE_SOURCE and NATIVE_CATEGORY are recommended-value objects
    // but the types accept any string
    expect(mod.REFERENCE_SOURCE.TASK).toBe("task");
    expect(mod.NATIVE_CATEGORY.DECISION).toBe("decision");
  });
});
