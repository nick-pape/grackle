import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOpenNeo4j,
  mockInitSchema,
  mockCloseNeo4j,
  mockCreateLocalEmbedder,
} = vi.hoisted(() => ({
  mockOpenNeo4j: vi.fn().mockResolvedValue(undefined),
  mockInitSchema: vi.fn().mockResolvedValue(undefined),
  mockCloseNeo4j: vi.fn().mockResolvedValue(undefined),
  mockCreateLocalEmbedder: vi.fn().mockReturnValue({ dimensions: 384, embed: vi.fn(), embedBatch: vi.fn() }),
}));

vi.mock("@grackle-ai/knowledge", () => ({
  openNeo4j: mockOpenNeo4j,
  initSchema: mockInitSchema,
  closeNeo4j: mockCloseNeo4j,
  createLocalEmbedder: mockCreateLocalEmbedder,
  healthCheck: vi.fn().mockResolvedValue(true),
}));

import { initKnowledge } from "./knowledge-init.js";
import type { PluginContext } from "@grackle-ai/plugin-sdk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(): PluginContext {
  return {
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    emit: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PluginContext["logger"],
    config: {
      grpcPort: 7434, webPort: 3000, mcpPort: 7435, powerlinePort: 7433,
      host: "127.0.0.1", grackleHome: "/tmp/.grackle", apiKey: "test-key",
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("initKnowledge", () => {
  beforeEach(() => {
    mockOpenNeo4j.mockClear();
    mockInitSchema.mockClear();
    mockCloseNeo4j.mockClear();
    mockCreateLocalEmbedder.mockClear();
  });

  it("opens Neo4j and initializes schema", async () => {
    await initKnowledge(makeCtx());
    expect(mockOpenNeo4j).toHaveBeenCalledTimes(1);
    expect(mockInitSchema).toHaveBeenCalledTimes(1);
  });

  it("creates a local embedder for gRPC handlers", async () => {
    await initKnowledge(makeCtx());
    expect(mockCreateLocalEmbedder).toHaveBeenCalledTimes(1);
  });

  it("returns a cleanup function that closes Neo4j", async () => {
    const cleanup = await initKnowledge(makeCtx());
    await cleanup();
    expect(mockCloseNeo4j).toHaveBeenCalledTimes(1);
  });
});
