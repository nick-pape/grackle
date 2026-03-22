import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted() so variables are available in hoisted vi.mock()
// ---------------------------------------------------------------------------

const { mockSessionRun, mockSessionClose, mockSession } = vi.hoisted(() => {
  const mockSessionRun = vi.fn().mockResolvedValue({ records: [] });
  const mockSessionClose = vi.fn().mockResolvedValue(undefined);
  const mockSession = { run: mockSessionRun, close: mockSessionClose };
  return { mockSessionRun, mockSessionClose, mockSession };
});

vi.mock("./client.js", () => ({
  getSession: vi.fn(() => mockSession),
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  createReferenceNode,
  createNativeNode,
  getNode,
  deleteNode,
  updateNode,
  recordToNode,
} from "./node-store.js";
import { NODE_KIND, REFERENCE_SOURCE, NATIVE_CATEGORY } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNeo4jRecord(data: Record<string, unknown>) {
  return { get: (key: string) => data[key] };
}

function makeNeo4jNode(properties: Record<string, unknown>) {
  return { properties };
}

const REFERENCE_PROPS = {
  id: "ref-1",
  kind: "reference",
  sourceType: "task",
  sourceId: "task-123",
  label: "Fix login bug",
  embedding: [0.1, 0.2],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  workspaceId: "ws-1",
};

const NATIVE_PROPS = {
  id: "native-1",
  kind: "native",
  category: "decision",
  title: "Use Neo4j",
  content: "We decided to use Neo4j.",
  tags: ["architecture"],
  embedding: [0.3, 0.4],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  workspaceId: "",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("recordToNode", () => {
  it("maps reference node properties", () => {
    const node = recordToNode(REFERENCE_PROPS);
    expect(node.kind).toBe(NODE_KIND.REFERENCE);
    if (node.kind === NODE_KIND.REFERENCE) {
      expect(node.sourceType).toBe("task");
      expect(node.sourceId).toBe("task-123");
      expect(node.label).toBe("Fix login bug");
    }
  });

  it("maps native node properties", () => {
    const node = recordToNode(NATIVE_PROPS);
    expect(node.kind).toBe(NODE_KIND.NATIVE);
    if (node.kind === NODE_KIND.NATIVE) {
      expect(node.category).toBe("decision");
      expect(node.title).toBe("Use Neo4j");
      expect(node.content).toBe("We decided to use Neo4j.");
      expect(node.tags).toEqual(["architecture"]);
    }
  });

  it("defaults missing arrays and strings", () => {
    const node = recordToNode({ ...NATIVE_PROPS, tags: undefined, content: undefined });
    if (node.kind === NODE_KIND.NATIVE) {
      expect(node.tags).toEqual([]);
      expect(node.content).toBe("");
    }
  });
});

describe("createReferenceNode", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
    mockSessionRun.mockResolvedValue({ records: [] });
  });

  it("creates a node with correct properties and returns a UUID", async () => {
    const id = await createReferenceNode({
      sourceType: REFERENCE_SOURCE.TASK,
      sourceId: "task-1",
      label: "My task",
      embedding: [0.1],
      workspaceId: "ws-1",
    });

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(mockSessionRun).toHaveBeenCalledTimes(1);

    const [cypher, params] = mockSessionRun.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain("CREATE");
    expect(cypher).toContain("KnowledgeNode");

    const props = params.props as Record<string, unknown>;
    expect(props.kind).toBe("reference");
    expect(props.sourceType).toBe("task");
    expect(props.sourceId).toBe("task-1");
    expect(props.label).toBe("My task");
    expect(props.embedding).toEqual([0.1]);
    expect(props.createdAt).toBeDefined();
    expect(props.updatedAt).toBe(props.createdAt);
  });

  it("closes the session after success", async () => {
    await createReferenceNode({
      sourceType: REFERENCE_SOURCE.TASK,
      sourceId: "t",
      label: "l",
      embedding: [],
      workspaceId: "",
    });
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });

  it("closes the session after failure", async () => {
    mockSessionRun.mockRejectedValueOnce(new Error("neo4j error"));
    await expect(
      createReferenceNode({
        sourceType: REFERENCE_SOURCE.TASK,
        sourceId: "t",
        label: "l",
        embedding: [],
        workspaceId: "",
      }),
    ).rejects.toThrow("neo4j error");
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });
});

describe("createNativeNode", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
    mockSessionRun.mockResolvedValue({ records: [] });
  });

  it("creates a node with native-specific fields", async () => {
    const id = await createNativeNode({
      category: NATIVE_CATEGORY.INSIGHT,
      title: "Insight",
      content: "Some content",
      tags: ["tag1", "tag2"],
      embedding: [0.5],
      workspaceId: "ws-2",
    });

    expect(id).toBeDefined();

    const props = (mockSessionRun.mock.calls[0] as [string, Record<string, unknown>])[1]
      .props as Record<string, unknown>;
    expect(props.kind).toBe("native");
    expect(props.category).toBe("insight");
    expect(props.title).toBe("Insight");
    expect(props.tags).toEqual(["tag1", "tag2"]);
  });
});

describe("getNode", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
  });

  it("returns undefined when node not found", async () => {
    mockSessionRun.mockResolvedValueOnce({ records: [] });
    const result = await getNode("nonexistent");
    expect(result).toBeUndefined();
  });

  it("returns node with edges", async () => {
    const record = makeNeo4jRecord({
      n: makeNeo4jNode(NATIVE_PROPS),
      edges: [
        {
          fromId: "native-1",
          toId: "ref-1",
          type: "RELATES_TO",
          metadata: JSON.stringify({ confidence: 0.9 }),
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    const result = await getNode("native-1");

    expect(result).toBeDefined();
    expect(result!.node.id).toBe("native-1");
    expect(result!.node.kind).toBe(NODE_KIND.NATIVE);
    expect(result!.edges).toHaveLength(1);
    expect(result!.edges[0].type).toBe("RELATES_TO");
    expect(result!.edges[0].metadata).toEqual({ confidence: 0.9 });
  });

  it("returns node with empty edges when no relationships exist", async () => {
    const record = makeNeo4jRecord({
      n: makeNeo4jNode(REFERENCE_PROPS),
      edges: [],
    });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    const result = await getNode("ref-1");

    expect(result).toBeDefined();
    expect(result!.node.kind).toBe(NODE_KIND.REFERENCE);
    expect(result!.edges).toEqual([]);
  });

  it("handles null edge metadata", async () => {
    const record = makeNeo4jRecord({
      n: makeNeo4jNode(NATIVE_PROPS),
      edges: [
        {
          fromId: "native-1",
          toId: "ref-1",
          type: "DEPENDS_ON",
          metadata: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    const result = await getNode("native-1");
    expect(result!.edges[0].metadata).toBeUndefined();
  });

  it("closes the session", async () => {
    mockSessionRun.mockResolvedValueOnce({ records: [] });
    await getNode("any");
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });
});

describe("deleteNode", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
  });

  it("returns true when node was deleted", async () => {
    const record = makeNeo4jRecord({ deleted: 1 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    expect(await deleteNode("node-1")).toBe(true);
  });

  it("returns false when node not found", async () => {
    const record = makeNeo4jRecord({ deleted: 0 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    expect(await deleteNode("nonexistent")).toBe(false);
  });

  it("uses DETACH DELETE", async () => {
    const record = makeNeo4jRecord({ deleted: 1 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    await deleteNode("node-1");

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).toContain("DETACH DELETE");
  });

  it("closes the session", async () => {
    const record = makeNeo4jRecord({ deleted: 0 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });
    await deleteNode("any");
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });
});

describe("updateNode", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
  });

  it("returns undefined when node not found", async () => {
    mockSessionRun.mockResolvedValueOnce({ records: [] });
    const result = await updateNode("nonexistent", { title: "New" });
    expect(result).toBeUndefined();
  });

  it("merges updates and sets updatedAt", async () => {
    const updatedProps = { ...NATIVE_PROPS, title: "Updated", updatedAt: "2026-06-01T00:00:00.000Z" };
    const record = makeNeo4jRecord({ n: makeNeo4jNode(updatedProps) });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    const result = await updateNode("native-1", { title: "Updated" });

    expect(result).toBeDefined();
    expect(result!.id).toBe("native-1");

    const params = mockSessionRun.mock.calls[0][1] as Record<string, unknown>;
    const updates = params.updates as Record<string, unknown>;
    expect(updates.title).toBe("Updated");
    expect(updates.updatedAt).toBeDefined();
  });

  it("strips immutable fields", async () => {
    const record = makeNeo4jRecord({ n: makeNeo4jNode(NATIVE_PROPS) });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    // Sneak in immutable fields via type assertion
    await updateNode("native-1", {
      title: "New",
      kind: "reference",
      id: "hacked",
      createdAt: "hacked",
      workspaceId: "hacked",
    } as unknown as UpdateNativeNodeInput);

    const params = mockSessionRun.mock.calls[0][1] as Record<string, unknown>;
    const updates = params.updates as Record<string, unknown>;
    expect(updates.kind).toBeUndefined();
    expect(updates.id).toBeUndefined();
    expect(updates.createdAt).toBeUndefined();
    expect(updates.workspaceId).toBeUndefined();
    expect(updates.title).toBe("New");
  });

  it("closes the session", async () => {
    mockSessionRun.mockResolvedValueOnce({ records: [] });
    await updateNode("any", { title: "x" });
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });
});
