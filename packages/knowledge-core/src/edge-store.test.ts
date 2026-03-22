import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
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

import { createEdge, removeEdge } from "./edge-store.js";
import { EDGE_TYPE } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNeo4jRecord(data: Record<string, unknown>) {
  return { get: (key: string) => data[key] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createEdge", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
  });

  it("creates an edge and returns it", async () => {
    const record = makeNeo4jRecord({
      fromId: "a",
      toId: "b",
      type: "RELATES_TO",
      metadata: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    const edge = await createEdge("a", "b", EDGE_TYPE.RELATES_TO);

    expect(edge.fromId).toBe("a");
    expect(edge.toId).toBe("b");
    expect(edge.type).toBe("RELATES_TO");
    expect(edge.metadata).toBeUndefined();
    expect(edge.createdAt).toBeDefined();
  });

  it("stores metadata as JSON string", async () => {
    const record = makeNeo4jRecord({
      fromId: "a",
      toId: "b",
      type: "DEPENDS_ON",
      metadata: JSON.stringify({ confidence: 0.9 }),
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    const edge = await createEdge("a", "b", EDGE_TYPE.DEPENDS_ON, {
      confidence: 0.9,
    });

    // Verify metadata was passed as JSON string to session.run
    const params = mockSessionRun.mock.calls[0][1] as Record<string, unknown>;
    expect(params.metadata).toBe('{"confidence":0.9}');

    // Verify returned edge has parsed metadata
    expect(edge.metadata).toEqual({ confidence: 0.9 });
  });

  it("passes null metadata when not provided", async () => {
    const record = makeNeo4jRecord({
      fromId: "a",
      toId: "b",
      type: "RELATES_TO",
      metadata: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    await createEdge("a", "b", EDGE_TYPE.RELATES_TO);

    const params = mockSessionRun.mock.calls[0][1] as Record<string, unknown>;
    expect(params.metadata).toBeNull();
  });

  it("interpolates edge type into Cypher (not as parameter)", async () => {
    const record = makeNeo4jRecord({
      fromId: "a",
      toId: "b",
      type: "DERIVED_FROM",
      metadata: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    await createEdge("a", "b", EDGE_TYPE.DERIVED_FROM);

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).toContain(":DERIVED_FROM");
  });

  it("throws when nodes not found", async () => {
    mockSessionRun.mockResolvedValueOnce({ records: [] });

    await expect(createEdge("x", "y", EDGE_TYPE.RELATES_TO)).rejects.toThrow(
      "Cannot create edge: one or both nodes not found",
    );
  });

  it("throws on invalid edge type", async () => {
    await expect(
      createEdge("a", "b", "INVALID_TYPE" as unknown as typeof EDGE_TYPE.RELATES_TO),
    ).rejects.toThrow("Invalid edge type");
  });

  it("closes the session after success", async () => {
    const record = makeNeo4jRecord({
      fromId: "a",
      toId: "b",
      type: "RELATES_TO",
      metadata: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    await createEdge("a", "b", EDGE_TYPE.RELATES_TO);
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });

  it("closes the session after failure", async () => {
    mockSessionRun.mockRejectedValueOnce(new Error("neo4j error"));

    await expect(
      createEdge("a", "b", EDGE_TYPE.RELATES_TO),
    ).rejects.toThrow("neo4j error");
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });
});

describe("removeEdge", () => {
  beforeEach(() => {
    mockSessionRun.mockClear();
    mockSessionClose.mockClear();
  });

  it("returns true when edge was removed", async () => {
    const record = makeNeo4jRecord({ deleted: 1 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    expect(await removeEdge("a", "b", EDGE_TYPE.RELATES_TO)).toBe(true);
  });

  it("returns false when no matching edge", async () => {
    const record = makeNeo4jRecord({ deleted: 0 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    expect(await removeEdge("a", "b", EDGE_TYPE.RELATES_TO)).toBe(false);
  });

  it("uses directional match in Cypher", async () => {
    const record = makeNeo4jRecord({ deleted: 0 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    await removeEdge("a", "b", EDGE_TYPE.MENTIONS);

    const cypher = mockSessionRun.mock.calls[0][0] as string;
    expect(cypher).toContain(":MENTIONS");
    expect(cypher).toContain("->");
  });

  it("throws on invalid edge type", async () => {
    await expect(
      removeEdge("a", "b", "BAD_TYPE" as unknown as typeof EDGE_TYPE.RELATES_TO),
    ).rejects.toThrow("Invalid edge type");
  });

  it("closes the session", async () => {
    const record = makeNeo4jRecord({ deleted: 0 });
    mockSessionRun.mockResolvedValueOnce({ records: [record] });

    await removeEdge("a", "b", EDGE_TYPE.RELATES_TO);
    expect(mockSessionClose).toHaveBeenCalledTimes(1);
  });
});
