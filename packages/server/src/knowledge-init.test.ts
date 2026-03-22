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
  mockSetKnowledgeEmbedder,
  mockSubscribe,
  mockGetTask,
  mockQueryFindings,
} = vi.hoisted(() => ({
  mockOpenNeo4j: vi.fn().mockResolvedValue(undefined),
  mockInitSchema: vi.fn().mockResolvedValue(undefined),
  mockCloseNeo4j: vi.fn().mockResolvedValue(undefined),
  mockCreateLocalEmbedder: vi.fn().mockReturnValue({ dimensions: 384, embed: vi.fn(), embedBatch: vi.fn() }),
  mockSyncReferenceNode: vi.fn().mockResolvedValue("node-id"),
  mockDeleteReferenceNodeBySource: vi.fn().mockResolvedValue(true),
  mockFindReferenceNodeBySource: vi.fn().mockResolvedValue(undefined),
  mockCreateEdge: vi.fn().mockResolvedValue({ fromId: "a", toId: "b", type: "RELATES_TO", createdAt: "" }),
  mockSetKnowledgeEmbedder: vi.fn(),
  mockSubscribe: vi.fn().mockReturnValue(vi.fn()),
  mockGetTask: vi.fn(),
  mockQueryFindings: vi.fn().mockReturnValue([]),
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
}));

vi.mock("@grackle-ai/mcp", () => ({
  setKnowledgeEmbedder: mockSetKnowledgeEmbedder,
}));

vi.mock("./event-bus.js", () => ({
  subscribe: mockSubscribe,
}));

vi.mock("./task-store.js", () => ({
  getTask: mockGetTask,
}));

vi.mock("./finding-store.js", () => ({
  queryFindings: mockQueryFindings,
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { isKnowledgeEnabled, initKnowledge } from "./knowledge-init.js";
import type { GrackleEvent } from "./event-bus.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isKnowledgeEnabled", () => {
  const originalEnv = process.env.GRACKLE_KNOWLEDGE_ENABLED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GRACKLE_KNOWLEDGE_ENABLED;
    } else {
      process.env.GRACKLE_KNOWLEDGE_ENABLED = originalEnv;
    }
  });

  it("returns false when env var is not set", () => {
    delete process.env.GRACKLE_KNOWLEDGE_ENABLED;
    expect(isKnowledgeEnabled()).toBe(false);
  });

  it("returns true when env var is 'true'", () => {
    process.env.GRACKLE_KNOWLEDGE_ENABLED = "true";
    expect(isKnowledgeEnabled()).toBe(true);
  });

  it("returns false for other values", () => {
    process.env.GRACKLE_KNOWLEDGE_ENABLED = "1";
    expect(isKnowledgeEnabled()).toBe(false);
  });
});

describe("initKnowledge", () => {
  beforeEach(() => {
    mockOpenNeo4j.mockClear();
    mockInitSchema.mockClear();
    mockCloseNeo4j.mockClear();
    mockCreateLocalEmbedder.mockClear();
    mockSetKnowledgeEmbedder.mockClear();
    mockSubscribe.mockClear();
    mockSubscribe.mockReturnValue(vi.fn());
  });

  it("opens Neo4j and initializes schema", async () => {
    await initKnowledge();
    expect(mockOpenNeo4j).toHaveBeenCalledTimes(1);
    expect(mockInitSchema).toHaveBeenCalledTimes(1);
  });

  it("creates a local embedder and injects it into MCP", async () => {
    await initKnowledge();
    expect(mockCreateLocalEmbedder).toHaveBeenCalledTimes(1);
    expect(mockSetKnowledgeEmbedder).toHaveBeenCalledWith(expect.objectContaining({ dimensions: 384 }));
  });

  it("subscribes to the event bus", async () => {
    await initKnowledge();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(typeof mockSubscribe.mock.calls[0][0]).toBe("function");
  });

  it("returns a cleanup function that closes Neo4j and unsubscribes", async () => {
    const mockUnsubscribe = vi.fn();
    mockSubscribe.mockReturnValue(mockUnsubscribe);

    const cleanup = await initKnowledge();
    await cleanup();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockSetKnowledgeEmbedder).toHaveBeenLastCalledWith(undefined);
    expect(mockCloseNeo4j).toHaveBeenCalledTimes(1);
  });
});

describe("entity sync handler", () => {
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

    await initKnowledge();
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
    // ensureTaskReferenceNode: parent not yet synced, getTask returns parent
    mockFindReferenceNodeBySource.mockResolvedValue(undefined);
    mockSyncReferenceNode
      .mockResolvedValueOnce("child-node-id")   // child sync
      .mockResolvedValueOnce("parent-node-id"); // parent ensure

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
