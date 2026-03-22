import { describe, it, expect, vi } from "vitest";

// Mock the core package's neo4j-driver dependency so imports don't fail
vi.mock("neo4j-driver", () => ({
  default: {
    driver: vi.fn(),
    auth: { basic: vi.fn() },
  },
}));

describe("@grackle-ai/knowledge", () => {
  it("re-exports core functions", async () => {
    const mod = await import("./index.js");
    // Client
    expect(typeof mod.openNeo4j).toBe("function");
    expect(typeof mod.closeNeo4j).toBe("function");
    // Node CRUD
    expect(typeof mod.createReferenceNode).toBe("function");
    expect(typeof mod.createNativeNode).toBe("function");
    expect(typeof mod.getNode).toBe("function");
    // Search + expand
    expect(typeof mod.knowledgeSearch).toBe("function");
    expect(typeof mod.expandNode).toBe("function");
    // Types
    expect(mod.NODE_KIND).toBeDefined();
    expect(mod.EDGE_TYPE).toBeDefined();
  });

  it("exports Grackle-specific reference sync functions", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.findReferenceNodeBySource).toBe("function");
    expect(typeof mod.deleteReferenceNodeBySource).toBe("function");
    expect(typeof mod.syncReferenceNode).toBe("function");
    expect(typeof mod.deriveTaskText).toBe("function");
    expect(typeof mod.deriveFindingText).toBe("function");
  });
});
