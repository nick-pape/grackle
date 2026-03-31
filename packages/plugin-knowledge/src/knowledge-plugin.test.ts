import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginContext } from "@grackle-ai/plugin-sdk";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockInitKnowledge,
  mockCreateEntitySyncSubscriber,
  mockCreateKnowledgeHealthPhase,
  mockSearchKnowledge,
  mockGetKnowledgeNode,
  mockExpandKnowledgeNode,
  mockListRecentKnowledgeNodes,
  mockCreateKnowledgeNode,
  mockKnowledgeMcpTools,
} = vi.hoisted(() => ({
  mockInitKnowledge: vi.fn().mockResolvedValue(vi.fn()),
  mockCreateEntitySyncSubscriber: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  mockCreateKnowledgeHealthPhase: vi.fn().mockReturnValue({ name: "knowledge-health", execute: vi.fn() }),
  mockSearchKnowledge: vi.fn(),
  mockGetKnowledgeNode: vi.fn(),
  mockExpandKnowledgeNode: vi.fn(),
  mockListRecentKnowledgeNodes: vi.fn(),
  mockCreateKnowledgeNode: vi.fn(),
  mockKnowledgeMcpTools: [
    { name: "knowledge_search", group: "knowledge", description: "Search", inputSchema: {}, rpcMethod: "searchKnowledge", mutating: false, handler: vi.fn() },
    { name: "knowledge_get_node", group: "knowledge", description: "Get", inputSchema: {}, rpcMethod: "getKnowledgeNode", mutating: false, handler: vi.fn() },
    { name: "knowledge_create_node", group: "knowledge", description: "Create", inputSchema: {}, rpcMethod: "createKnowledgeNode", mutating: true, handler: vi.fn() },
  ],
}));

vi.mock("./knowledge-init.js", () => ({
  initKnowledge: mockInitKnowledge,
  createEntitySyncSubscriber: mockCreateEntitySyncSubscriber,
  neo4jHealthCheck: vi.fn().mockResolvedValue(true),
}));

vi.mock("./knowledge-health.js", () => ({
  createKnowledgeHealthPhase: mockCreateKnowledgeHealthPhase,
}));

vi.mock("./knowledge-handlers.js", () => ({
  searchKnowledge: mockSearchKnowledge,
  getKnowledgeNode: mockGetKnowledgeNode,
  expandKnowledgeNode: mockExpandKnowledgeNode,
  listRecentKnowledgeNodes: mockListRecentKnowledgeNodes,
  createKnowledgeNode: mockCreateKnowledgeNode,
}));

vi.mock("./mcp-tools.js", () => ({
  knowledgeMcpTools: mockKnowledgeMcpTools,
}));

vi.mock("@grackle-ai/common", () => ({
  grackle: { Grackle: { typeName: "grackle.Grackle" } },
}));

import { createKnowledgePlugin } from "./knowledge-plugin.js";

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

describe("createKnowledgePlugin", () => {
  it("returns plugin with name 'knowledge' and dependencies ['core']", () => {
    const plugin = createKnowledgePlugin();
    expect(plugin.name).toBe("knowledge");
    expect(plugin.dependencies).toEqual(["core"]);
  });
});

describe("knowledge plugin lifecycle", () => {
  beforeEach(() => {
    mockInitKnowledge.mockClear();
    mockInitKnowledge.mockResolvedValue(vi.fn());
  });

  it("initialize calls initKnowledge with context", async () => {
    const plugin = createKnowledgePlugin();
    const ctx = makeCtx();
    await plugin.initialize!(ctx);
    expect(mockInitKnowledge).toHaveBeenCalledWith(ctx);
  });

  it("shutdown calls stored cleanup function", async () => {
    const mockCleanup = vi.fn().mockResolvedValue(undefined);
    mockInitKnowledge.mockResolvedValue(mockCleanup);

    const plugin = createKnowledgePlugin();
    const ctx = makeCtx();
    await plugin.initialize!(ctx);
    await plugin.shutdown!();

    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it("shutdown clears cleanup after calling it", async () => {
    const mockCleanup = vi.fn().mockResolvedValue(undefined);
    mockInitKnowledge.mockResolvedValue(mockCleanup);

    const plugin = createKnowledgePlugin();
    const ctx = makeCtx();
    await plugin.initialize!(ctx);
    await plugin.shutdown!();
    await plugin.shutdown!(); // second call should be safe

    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });
});

describe("knowledge plugin grpcHandlers", () => {
  it("returns exactly 1 ServiceRegistration", () => {
    const plugin = createKnowledgePlugin();
    const ctx = makeCtx();
    const registrations = plugin.grpcHandlers!(ctx);
    expect(registrations).toHaveLength(1);
  });

  it("ServiceRegistration has exactly 5 handlers", () => {
    const plugin = createKnowledgePlugin();
    const ctx = makeCtx();
    const [reg] = plugin.grpcHandlers!(ctx);
    const handlerNames = Object.keys(reg.handlers);
    expect(handlerNames).toHaveLength(5);
    expect(handlerNames).toContain("searchKnowledge");
    expect(handlerNames).toContain("getKnowledgeNode");
    expect(handlerNames).toContain("expandKnowledgeNode");
    expect(handlerNames).toContain("listRecentKnowledgeNodes");
    expect(handlerNames).toContain("createKnowledgeNode");
  });
});

describe("knowledge plugin reconciliationPhases", () => {
  it("returns exactly 1 phase named 'knowledge-health'", () => {
    const plugin = createKnowledgePlugin();
    const ctx = makeCtx();
    const phases = plugin.reconciliationPhases!(ctx);
    expect(phases).toHaveLength(1);
    expect(phases[0].name).toBe("knowledge-health");
    expect(mockCreateKnowledgeHealthPhase).toHaveBeenCalled();
  });
});

describe("knowledge plugin eventSubscribers", () => {
  it("returns exactly 1 Disposable", () => {
    const plugin = createKnowledgePlugin();
    const ctx = makeCtx();
    const subscribers = plugin.eventSubscribers!(ctx);
    expect(subscribers).toHaveLength(1);
    expect(typeof subscribers[0].dispose).toBe("function");
    expect(mockCreateEntitySyncSubscriber).toHaveBeenCalledWith(ctx);
  });
});

describe("knowledge plugin mcpTools", () => {
  it("returns exactly 3 PluginToolDefinition entries", () => {
    const plugin = createKnowledgePlugin();
    const ctx = makeCtx();
    const tools = plugin.mcpTools!(ctx);
    expect(tools).toHaveLength(3);
  });

  it("includes knowledge_search, knowledge_get_node, knowledge_create_node", () => {
    const plugin = createKnowledgePlugin();
    const ctx = makeCtx();
    const tools = plugin.mcpTools!(ctx);
    const names = tools.map((t) => t.name);
    expect(names).toContain("knowledge_search");
    expect(names).toContain("knowledge_get_node");
    expect(names).toContain("knowledge_create_node");
  });
});
