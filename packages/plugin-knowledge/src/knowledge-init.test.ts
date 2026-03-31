import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockOpenNeo4j,
  mockInitSchema,
  mockCloseNeo4j,
  mockCreateLocalEmbedder,
  mockSyncReferenceNode,
  mockDeleteReferenceNodeBySource,
  mockFindReferenceNodeBySource,
  mockCreateEdge,
  mockSubscribe,
  mockGetTask,
  mockQueryFindings,
  mockIsNeo4jHealthy,
} = vi.hoisted(() => ({
  mockOpenNeo4j: vi.fn().mockResolvedValue(undefined),
  mockInitSchema: vi.fn().mockResolvedValue(undefined),
  mockCloseNeo4j: vi.fn().mockResolvedValue(undefined),
  mockCreateLocalEmbedder: vi.fn().mockReturnValue({ dimensions: 384, embed: vi.fn(), embedBatch: vi.fn() }),
  mockSyncReferenceNode: vi.fn().mockResolvedValue("node-id"),
  mockDeleteReferenceNodeBySource: vi.fn().mockResolvedValue(true),
  mockFindReferenceNodeBySource: vi.fn().mockResolvedValue(undefined),
  mockCreateEdge: vi.fn().mockResolvedValue({ fromId: "a", toId: "b", type: "RELATES_TO", createdAt: "" }),
  mockSubscribe: vi.fn().mockReturnValue(vi.fn()),
  mockGetTask: vi.fn(),
  mockQueryFindings: vi.fn().mockReturnValue([]),
  mockIsNeo4jHealthy: vi.fn().mockReturnValue(true),
}));

vi.mock("@grackle-ai/knowledge", () => ({
  openNeo4j: mockOpenNeo4j,
  initSchema: mockInitSchema,
  closeNeo4j: mockCloseNeo4j,
  createLocalEmbedder: mockCreateLocalEmbedder,
  syncReferenceNode: mockSyncReferenceNode,
  deleteReferenceNodeBySource: mockDeleteReferenceNodeBySource,
  findReferenceNodeBySource: mockFindReferenceNodeBySource,
  createEdge: mockCreateEdge,
  deriveTaskText: (title: string, desc: string) => `[Task] ${title} - ${desc}`,
  deriveFindingText: (title: string, content: string, tags: string[]) => `[Finding] ${title} - ${content}`,
  EDGE_TYPE: {
    RELATES_TO: "RELATES_TO",
    DEPENDS_ON: "DEPENDS_ON",
    DERIVED_FROM: "DERIVED_FROM",
    MENTIONS: "MENTIONS",
    PART_OF: "PART_OF",
  },
  healthCheck: vi.fn().mockResolvedValue(true),
}));

vi.mock("@grackle-ai/database", async () => {
  return {
    taskStore: { getTask: mockGetTask },
    findingStore: { queryFindings: mockQueryFindings },
    safeParseJsonArray: (val: string | null): string[] => {
      if (!val) {
        return [];
      }
      try {
        return JSON.parse(val) as string[];
      } catch {
        return [];
      }
    },
  };
});

vi.mock("./knowledge-health.js", () => ({
  isNeo4jHealthy: mockIsNeo4jHealthy,
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { initKnowledge, createEntitySyncSubscriber } from "./knowledge-init.js";
import type { GrackleEvent, PluginContext } from "@grackle-ai/plugin-sdk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<PluginContext>): PluginContext {
  return {
    subscribe: mockSubscribe,
    emit: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PluginContext["logger"],
    config: {
      grpcPort: 7434, webPort: 3000, mcpPort: 7435, powerlinePort: 7433,
      host: "127.0.0.1", grackleHome: "/tmp/.grackle", apiKey: "test-key",
    },
    ...overrides,
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
    mockSubscribe.mockClear();
    mockSubscribe.mockReturnValue(vi.fn());
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

describe("createEntitySyncSubscriber", () => {
  let eventHandler: (event: GrackleEvent) => void;

  beforeEach(async () => {
    mockSyncReferenceNode.mockClear();
    mockSyncReferenceNode.mockResolvedValue("node-id");
    mockDeleteReferenceNodeBySource.mockClear();
    mockFindReferenceNodeBySource.mockClear();
    mockFindReferenceNodeBySource.mockResolvedValue(undefined);
    mockCreateEdge.mockClear();
    mockGetTask.mockClear();
    mockQueryFindings.mockClear();

    // Capture the event handler passed to subscribe
    mockSubscribe.mockImplementation((handler: (event: GrackleEvent) => void) => {
      eventHandler = handler;
      return vi.fn();
    });

    // Must init first so embedder is available, then subscribe to set eventHandler
    await initKnowledge(makeCtx());
    createEntitySyncSubscriber(makeCtx());
  });

  it("subscribes to events via ctx.subscribe", () => {
    const ctx = makeCtx();
    mockSubscribe.mockClear();
    createEntitySyncSubscriber(ctx);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it("returns a Disposable that calls unsubscribe on dispose", () => {
    const mockUnsubscribe = vi.fn();
    mockSubscribe.mockReturnValue(mockUnsubscribe);
    const ctx = makeCtx();
    const disposable = createEntitySyncSubscriber(ctx);
    disposable.dispose();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("syncs a task on task.created", async () => {
    mockGetTask.mockReturnValue({
      id: "t1",
      title: "Fix bug",
      description: "Auth is broken",
      workspaceId: "ws-1",
      parentTaskId: "",
      dependsOn: "[]",
    });

    eventHandler({
      id: "evt-1",
      type: "task.created",
      timestamp: new Date().toISOString(),
      payload: { taskId: "t1", workspaceId: "ws-1" },
    });

    // Wait for the async handler
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSyncReferenceNode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourceType: "task",
        sourceId: "t1",
        label: "Fix bug",
        workspaceId: "ws-1",
      }),
    );
  });

  it("syncs a task on task.updated", async () => {
    mockGetTask.mockReturnValue({
      id: "t1",
      title: "Updated title",
      description: "New desc",
      workspaceId: "ws-1",
      parentTaskId: "",
      dependsOn: "[]",
    });

    eventHandler({
      id: "evt-2",
      type: "task.updated",
      timestamp: new Date().toISOString(),
      payload: { taskId: "t1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSyncReferenceNode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceId: "t1", label: "Updated title" }),
    );
  });

  it("deletes reference node on task.deleted", async () => {
    eventHandler({
      id: "evt-3",
      type: "task.deleted",
      timestamp: new Date().toISOString(),
      payload: { taskId: "t1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockDeleteReferenceNodeBySource).toHaveBeenCalledWith("task", "t1");
  });

  it("syncs a finding on finding.posted", async () => {
    mockQueryFindings.mockReturnValue([
      { id: "f1", title: "Auth issue", content: "JWT expired", tags: '["auth"]' },
    ]);

    eventHandler({
      id: "evt-4",
      type: "finding.posted",
      timestamp: new Date().toISOString(),
      payload: { findingId: "f1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSyncReferenceNode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sourceType: "finding",
        sourceId: "f1",
        label: "Auth issue",
      }),
    );
  });

  it("skips when task not found", async () => {
    mockGetTask.mockReturnValue(undefined);

    eventHandler({
      id: "evt-5",
      type: "task.created",
      timestamp: new Date().toISOString(),
      payload: { taskId: "missing" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSyncReferenceNode).not.toHaveBeenCalled();
  });

  it("does not crash on sync errors", async () => {
    mockGetTask.mockReturnValue({
      id: "t1",
      title: "T",
      description: "D",
      workspaceId: "",
      parentTaskId: "",
      dependsOn: "[]",
    });
    mockSyncReferenceNode.mockRejectedValueOnce(new Error("Neo4j down"));

    eventHandler({
      id: "evt-6",
      type: "task.created",
      timestamp: new Date().toISOString(),
      payload: { taskId: "t1" },
    });

    // Should not throw
    await new Promise((r) => setTimeout(r, 10));
  });

  it("creates PART_OF edge for task with parent", async () => {
    mockGetTask.mockReturnValue({
      id: "child-1",
      title: "Child task",
      description: "Subtask",
      workspaceId: "ws-1",
      parentTaskId: "parent-1",
      dependsOn: "[]",
    });
    mockFindReferenceNodeBySource.mockResolvedValue(undefined);
    mockSyncReferenceNode
      .mockResolvedValueOnce("child-node-id")
      .mockResolvedValueOnce("parent-node-id");

    eventHandler({
      id: "evt-10",
      type: "task.created",
      timestamp: new Date().toISOString(),
      payload: { taskId: "child-1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockCreateEdge).toHaveBeenCalledWith("child-node-id", "parent-node-id", "PART_OF");
  });

  it("creates DEPENDS_ON edges for task with dependencies", async () => {
    mockGetTask
      .mockReturnValueOnce({
        id: "t1",
        title: "Task 1",
        description: "Desc",
        workspaceId: "ws-1",
        parentTaskId: "",
        dependsOn: '["dep-1","dep-2"]',
      })
      .mockReturnValueOnce({ id: "dep-1", title: "Dep 1", description: "D", workspaceId: "ws-1", parentTaskId: "", dependsOn: "[]" })
      .mockReturnValueOnce({ id: "dep-2", title: "Dep 2", description: "D", workspaceId: "ws-1", parentTaskId: "", dependsOn: "[]" });

    mockSyncReferenceNode
      .mockResolvedValueOnce("t1-node")
      .mockResolvedValueOnce("dep1-node")
      .mockResolvedValueOnce("dep2-node");

    eventHandler({
      id: "evt-11",
      type: "task.created",
      timestamp: new Date().toISOString(),
      payload: { taskId: "t1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockCreateEdge).toHaveBeenCalledWith("t1-node", "dep1-node", "DEPENDS_ON");
    expect(mockCreateEdge).toHaveBeenCalledWith("t1-node", "dep2-node", "DEPENDS_ON");
  });

  it("creates DERIVED_FROM edge for finding with taskId", async () => {
    mockQueryFindings.mockReturnValue([
      { id: "f1", title: "Auth issue", content: "JWT expired", tags: '["auth"]', taskId: "t1" },
    ]);
    mockGetTask.mockReturnValue({
      id: "t1", title: "Fix auth", description: "D", workspaceId: "ws-1", parentTaskId: "", dependsOn: "[]",
    });
    mockSyncReferenceNode
      .mockResolvedValueOnce("finding-node-id")
      .mockResolvedValueOnce("task-node-id");

    eventHandler({
      id: "evt-12",
      type: "finding.posted",
      timestamp: new Date().toISOString(),
      payload: { findingId: "f1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockCreateEdge).toHaveBeenCalledWith("finding-node-id", "task-node-id", "DERIVED_FROM");
  });

  it("skips DERIVED_FROM edge when finding has no taskId", async () => {
    mockQueryFindings.mockReturnValue([
      { id: "f2", title: "Orphan finding", content: "No task", tags: "[]", taskId: "" },
    ]);

    eventHandler({
      id: "evt-13",
      type: "finding.posted",
      timestamp: new Date().toISOString(),
      payload: { findingId: "f2", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockCreateEdge).not.toHaveBeenCalled();
  });

  it("skips edge when parent task not found", async () => {
    mockGetTask
      .mockReturnValueOnce({
        id: "child-1",
        title: "Child",
        description: "D",
        workspaceId: "ws-1",
        parentTaskId: "missing-parent",
        dependsOn: "[]",
      })
      .mockReturnValueOnce(undefined); // parent not found

    eventHandler({
      id: "evt-14",
      type: "task.created",
      timestamp: new Date().toISOString(),
      payload: { taskId: "child-1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockCreateEdge).not.toHaveBeenCalled();
  });
});

describe("circuit breaker — skips sync when Neo4j is unhealthy", () => {
  let eventHandler: (event: GrackleEvent) => void;

  beforeEach(async () => {
    mockSyncReferenceNode.mockClear();
    mockSyncReferenceNode.mockResolvedValue("node-id");
    mockDeleteReferenceNodeBySource.mockClear();
    mockGetTask.mockClear();
    mockQueryFindings.mockClear();
    mockIsNeo4jHealthy.mockClear();

    mockSubscribe.mockImplementation((handler: (event: GrackleEvent) => void) => {
      eventHandler = handler;
      return vi.fn();
    });

    await initKnowledge(makeCtx());
    createEntitySyncSubscriber(makeCtx());
  });

  it("skips task sync when Neo4j is unhealthy", async () => {
    mockIsNeo4jHealthy.mockReturnValue(false);
    mockGetTask.mockReturnValue({
      id: "t1",
      title: "Fix bug",
      description: "Auth is broken",
      workspaceId: "ws-1",
      parentTaskId: "",
      dependsOn: "[]",
    });

    eventHandler({
      id: "evt-cb-1",
      type: "task.created",
      timestamp: new Date().toISOString(),
      payload: { taskId: "t1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSyncReferenceNode).not.toHaveBeenCalled();
  });

  it("skips task deletion when Neo4j is unhealthy", async () => {
    mockIsNeo4jHealthy.mockReturnValue(false);

    eventHandler({
      id: "evt-cb-2",
      type: "task.deleted",
      timestamp: new Date().toISOString(),
      payload: { taskId: "t1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockDeleteReferenceNodeBySource).not.toHaveBeenCalled();
  });

  it("skips finding sync when Neo4j is unhealthy", async () => {
    mockIsNeo4jHealthy.mockReturnValue(false);
    mockQueryFindings.mockReturnValue([
      { id: "f1", title: "Auth issue", content: "JWT expired", tags: '["auth"]' },
    ]);

    eventHandler({
      id: "evt-cb-3",
      type: "finding.posted",
      timestamp: new Date().toISOString(),
      payload: { findingId: "f1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSyncReferenceNode).not.toHaveBeenCalled();
  });

  it("proceeds with sync when Neo4j is healthy", async () => {
    mockIsNeo4jHealthy.mockReturnValue(true);
    mockGetTask.mockReturnValue({
      id: "t1",
      title: "Fix bug",
      description: "Auth is broken",
      workspaceId: "ws-1",
      parentTaskId: "",
      dependsOn: "[]",
    });

    eventHandler({
      id: "evt-cb-4",
      type: "task.created",
      timestamp: new Date().toISOString(),
      payload: { taskId: "t1", workspaceId: "ws-1" },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSyncReferenceNode).toHaveBeenCalled();
  });
});

// Avoid unused import warning for afterEach
const _afterEach = afterEach;
void _afterEach;
