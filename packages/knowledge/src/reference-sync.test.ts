import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockSessionRun,
  mockSessionClose,
  mockSession,
  mockCreateReferenceNode,
  mockUpdateNode,
} = vi.hoisted(() => {
  const mockSessionRun = vi.fn().mockResolvedValue({ records: [] });
  const mockSessionClose = vi.fn().mockResolvedValue(undefined);
  const mockSession = { run: mockSessionRun, close: mockSessionClose };
  const mockCreateReferenceNode = vi.fn().mockResolvedValue("new-id");
  const mockUpdateNode = vi.fn().mockResolvedValue(undefined);
  return {
    mockSessionRun,
    mockSessionClose,
    mockSession,
    mockCreateReferenceNode,
    mockUpdateNode,
  };
});

vi.mock("@grackle-ai/knowledge-core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@grackle-ai/knowledge-core");
  return {
    ...actual,
    getSession: vi.fn(() => mockSession),
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    createReferenceNode: mockCreateReferenceNode,
    updateNode: mockUpdateNode,
    recordToNode: (props: Record<string, unknown>) => props,
  };
});

import {
  findReferenceNodeBySource,
  deleteReferenceNodeBySource,
  syncReferenceNode,
  deriveTaskText,
  deriveFindingText,
} from "./reference-sync.js";
import { REFERENCE_SOURCE } from "@grackle-ai/knowledge-core";
import type { Embedder } from "@grackle-ai/knowledge-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNeo4jRecord(data: Record<string, unknown>) {
  return { get: (key: string) => data[key] };
}

function makeNeo4jNode(properties: Record<string, unknown>) {
  return { properties };
}

const REFERENCE_NODE_PROPS = {
  id: "ref-123",
  kind: "reference",
  sourceType: "task",
  sourceId: "task-42",
  label: "Fix login bug",
  embedding: [0.1, 0.2],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  workspaceId: "ws-1",
};

function createMockEmbedder(): Embedder {
  return {
    dimensions: 384,
    embed: vi.fn().mockResolvedValue({ text: "test", vector: [0.1, 0.2, 0.3] }),
    embedBatch: vi.fn().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe("deriveTaskText", () => {
  it("combines title and description", () => {
    expect(deriveTaskText("Fix login", "Auth module broken")).toBe(
      "[Task] Fix login - Auth module broken",
    );
  });

  it("omits description when empty", () => {
    expect(deriveTaskText("Fix login", "")).toBe("[Task] Fix login");
  });

  it("handles empty title", () => {
    expect(deriveTaskText("", "Some description")).toBe(
      "[Task]  - Some description",
    );
  });
});

describe("deriveFindingText", () => {
  it("combines title, content, and tags", () => {
    expect(deriveFindingText("Auth issue", "JWT expired", ["auth", "jwt"])).toBe(
      "[Finding] Auth issue - JWT expired - tags:auth,jwt",
    );
  });

  it("omits content when empty", () => {
    expect(deriveFindingText("Auth issue", "", ["auth"])).toBe(
      "[Finding] Auth issue - tags:auth",
    );
  });

  it("omits tags when empty", () => {
    expect(deriveFindingText("Auth issue", "JWT expired", [])).toBe(
      "[Finding] Auth issue - JWT expired",
    );
  });

  it("handles all empty", () => {
    expect(deriveFindingText("", "", [])).toBe("[Finding] ");
  });
});

// ---------------------------------------------------------------------------
// findReferenceNodeBySource
// ---------------------------------------------------------------------------

describe("findReferenceNodeBySource", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
  });

  it("returns undefined when no record found", async () => {
    mockSessionRun.mockResolvedValueOnce({ records: [] });
    const result = await findReferenceNodeBySource(
      REFERENCE_SOURCE.TASK,
      "task-99",
    );
    expect(result).toBeUndefined();
  });

  it("returns a ReferenceNode when found", async () => {
    const record = makeNeo4jRecord({
      n: makeNeo4jNode(REFERENCE_NODE_PROPS),
    });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    const result = await findReferenceNodeBySource(
      REFERENCE_SOURCE.TASK,
      "task-42",
    );

    expect(result).toBeDefined();
    expect(result!.id).toBe("ref-123");
    expect(result!.sourceType).toBe("task");
    expect(result!.sourceId).toBe("task-42");
  });

  it("passes correct Cypher parameters", async () => {
    mockSessionRun.mockResolvedValueOnce({ records: [] });
    await findReferenceNodeBySource(REFERENCE_SOURCE.FINDING, "finding-7");

    const params = mockSessionRun.mock.calls[0][1] as Record<string, unknown>;
    expect(params.sourceType).toBe("finding");
    expect(params.sourceId).toBe("finding-7");
  });

  it("closes the session after success", async () => {
    mockSessionRun.mockResolvedValueOnce({ records: [] });
    await findReferenceNodeBySource(REFERENCE_SOURCE.TASK, "t");
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });

  it("closes the session after failure", async () => {
    mockSessionRun.mockRejectedValueOnce(new Error("neo4j error"));
    await expect(
      findReferenceNodeBySource(REFERENCE_SOURCE.TASK, "t"),
    ).rejects.toThrow("neo4j error");
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// deleteReferenceNodeBySource
// ---------------------------------------------------------------------------

describe("deleteReferenceNodeBySource", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
  });

  it("returns true when a node was deleted", async () => {
    const record = makeNeo4jRecord({ deleted: 1 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    expect(
      await deleteReferenceNodeBySource(REFERENCE_SOURCE.TASK, "task-42"),
    ).toBe(true);
  });

  it("returns false when no matching node", async () => {
    const record = makeNeo4jRecord({ deleted: 0 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    expect(
      await deleteReferenceNodeBySource(REFERENCE_SOURCE.TASK, "nonexistent"),
    ).toBe(false);
  });

  it("uses DETACH DELETE in Cypher", async () => {
    const record = makeNeo4jRecord({ deleted: 0 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    await deleteReferenceNodeBySource(REFERENCE_SOURCE.TASK, "t");

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).toContain("DETACH DELETE");
  });

  it("closes the session", async () => {
    const record = makeNeo4jRecord({ deleted: 0 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });
    await deleteReferenceNodeBySource(REFERENCE_SOURCE.TASK, "t");
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// syncReferenceNode
// ---------------------------------------------------------------------------

describe("syncReferenceNode", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
    mockCreateReferenceNode.mockClear();
    mockUpdateNode.mockClear();
    mockCreateReferenceNode.mockResolvedValue("new-id");
    mockUpdateNode.mockResolvedValue(undefined);
  });

  it("creates a new node when none exists", async () => {
    // findReferenceNodeBySource returns empty
    mockSessionRun.mockResolvedValueOnce({ records: [] });

    const embedder = createMockEmbedder();
    const nodeId = await syncReferenceNode(embedder, {
      sourceType: REFERENCE_SOURCE.TASK,
      sourceId: "task-1",
      label: "My task",
      text: "Fix the authentication bug",
      workspaceId: "ws-1",
    });

    expect(embedder.embed).toHaveBeenCalledWith("Fix the authentication bug");
    expect(mockCreateReferenceNode).toHaveBeenCalledWith({
      sourceType: "task",
      sourceId: "task-1",
      label: "My task",
      embedding: [0.1, 0.2, 0.3],
      workspaceId: "ws-1",
    });
    expect(mockUpdateNode).not.toHaveBeenCalled();
    expect(nodeId).toBe("new-id");
  });

  it("updates an existing node when found", async () => {
    // findReferenceNodeBySource returns existing node
    const record = makeNeo4jRecord({
      n: makeNeo4jNode(REFERENCE_NODE_PROPS),
    });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    const embedder = createMockEmbedder();
    const nodeId = await syncReferenceNode(embedder, {
      sourceType: REFERENCE_SOURCE.TASK,
      sourceId: "task-42",
      label: "Updated title",
      text: "Updated description",
      workspaceId: "ws-1",
    });

    expect(mockUpdateNode).toHaveBeenCalledWith("ref-123", {
      label: "Updated title",
      embedding: [0.1, 0.2, 0.3],
    });
    expect(mockCreateReferenceNode).not.toHaveBeenCalled();
    expect(nodeId).toBe("ref-123");
  });

  it("calls the embedder with the provided text", async () => {
    mockSessionRun.mockResolvedValueOnce({ records: [] });

    const embedder = createMockEmbedder();
    await syncReferenceNode(embedder, {
      sourceType: REFERENCE_SOURCE.FINDING,
      sourceId: "f-1",
      label: "Finding",
      text: "Some important finding content",
      workspaceId: "",
    });

    expect(embedder.embed).toHaveBeenCalledWith(
      "Some important finding content",
    );
  });

  it("propagates embedder errors", async () => {
    const embedder = createMockEmbedder();
    (embedder.embed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("embedding failed"),
    );

    await expect(
      syncReferenceNode(embedder, {
        sourceType: REFERENCE_SOURCE.TASK,
        sourceId: "t",
        label: "l",
        text: "text",
        workspaceId: "",
      }),
    ).rejects.toThrow("embedding failed");
  });
});
