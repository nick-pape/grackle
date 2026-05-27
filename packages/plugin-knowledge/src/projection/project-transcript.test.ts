import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionRow } from "@grackle-ai/database";

// ── Mocks ────────────────────────────────────────────────────

const core = vi.hoisted(() => ({ readLogFrom: vi.fn() }));
vi.mock("@grackle-ai/core", () => ({ logWriter: { readLogFrom: core.readLogFrom } }));

const kg = vi.hoisted(() => ({
  getReferenceNodeProps: vi.fn(),
  ingest: vi.fn(),
  createTranscriptChunker: vi.fn(() => ({ chunk: vi.fn() })),
  upsertReferenceNode: vi.fn().mockResolvedValue("node-id"),
  upsertEdge: vi.fn().mockResolvedValue(undefined),
  deleteReferenceNodesByPrefix: vi.fn().mockResolvedValue(3),
}));
vi.mock("@grackle-ai/knowledge", () => ({
  getReferenceNodeProps: kg.getReferenceNodeProps,
  ingest: kg.ingest,
  createTranscriptChunker: kg.createTranscriptChunker,
  upsertReferenceNode: kg.upsertReferenceNode,
  upsertEdge: kg.upsertEdge,
  deleteReferenceNodesByPrefix: kg.deleteReferenceNodesByPrefix,
  REFERENCE_SOURCE: { SESSION: "session", TRANSCRIPT_CHUNK: "transcript_chunk" },
  EDGE_TYPE: { PART_OF: "PART_OF" },
}));

import { projectSessionTranscript, unprojectSessionTranscript } from "./project-transcript.js";

const embedder = {} as unknown as Parameters<typeof projectSessionTranscript>[1];

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return { id: "s1", logPath: "/tmp/s1", ...overrides } as unknown as SessionRow;
}

describe("projectSessionTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kg.createTranscriptChunker.mockReturnValue({ chunk: vi.fn() });
    kg.upsertReferenceNode.mockResolvedValue("node-id");
  });

  it("returns 0 and does nothing when the session has no logPath", async () => {
    expect(await projectSessionTranscript(session({ logPath: null }), embedder)).toBe(0);
    expect(kg.getReferenceNodeProps).not.toHaveBeenCalled();
  });

  it("returns 0 when the session node is not projected yet", async () => {
    kg.getReferenceNodeProps.mockResolvedValue(undefined);
    expect(await projectSessionTranscript(session(), embedder)).toBe(0);
    expect(core.readLogFrom).not.toHaveBeenCalled();
  });

  it("returns 0 when there is no new log content", async () => {
    kg.getReferenceNodeProps.mockResolvedValue({
      id: "sess-node",
      workspaceId: "w",
      logByteOffset: 10,
    });
    core.readLogFrom.mockReturnValue({ content: "", nextOffset: 10 });
    expect(await projectSessionTranscript(session(), embedder)).toBe(0);
    expect(kg.ingest).not.toHaveBeenCalled();
  });

  it("chunks new content, upserts chunk nodes + PART_OF edges, and advances the cursor", async () => {
    kg.getReferenceNodeProps.mockResolvedValue({
      id: "sess-node",
      workspaceId: "w",
      label: "[Session] x",
      logByteOffset: 100,
      chunkCount: 5, // existing chunks → new chunk indices continue from here
    });
    core.readLogFrom.mockReturnValue({ content: "raw jsonl", nextOffset: 250 });
    kg.ingest.mockResolvedValue([
      { text: "chunk A", index: 0, vector: [0.1] },
      { text: "chunk B", index: 1, vector: [0.2] },
    ]);

    const created = await projectSessionTranscript(session(), embedder);
    expect(created).toBe(2);

    // Two chunk nodes, keyed continuing from chunkCount=5, carrying content + embedding.
    const chunkUpserts = kg.upsertReferenceNode.mock.calls.filter(
      ([input]) => (input as { sourceType: string }).sourceType === "transcript_chunk",
    );
    expect(chunkUpserts.map(([i]) => (i as { sourceId: string }).sourceId)).toEqual([
      "s1#5",
      "s1#6",
    ]);
    expect((chunkUpserts[0][0] as { content: string }).content).toBe("chunk A");
    expect((chunkUpserts[0][0] as { embedding: number[] }).embedding).toEqual([0.1]);

    // PART_OF edge from each chunk to the session node.
    expect(kg.upsertEdge).toHaveBeenCalledWith("node-id", "sess-node", "PART_OF");

    // Cursor advanced on the session node (byte offset + new chunk count).
    const cursorUpsert = kg.upsertReferenceNode.mock.calls.find(
      ([input]) => (input as { sourceType: string }).sourceType === "session",
    );
    expect((cursorUpsert![0] as { extraProps: Record<string, unknown> }).extraProps).toMatchObject({
      logByteOffset: 250,
      chunkCount: 7,
    });
  });

  it("advances the cursor with no chunks when readLogFrom skipped past an over-long line", async () => {
    kg.getReferenceNodeProps.mockResolvedValue({
      id: "sess-node",
      workspaceId: "w",
      label: "[Session] x",
      logByteOffset: 100,
      chunkCount: 2,
    });
    // Capped window with no complete line: content empty but the offset advanced.
    core.readLogFrom.mockReturnValue({ content: "", nextOffset: 1_148_676 });

    const created = await projectSessionTranscript(session(), embedder);
    expect(created).toBe(0);
    expect(kg.ingest).not.toHaveBeenCalled();

    // The cursor must still be persisted, or the over-long line stalls projection.
    const cursorUpsert = kg.upsertReferenceNode.mock.calls.find(
      ([input]) => (input as { sourceType: string }).sourceType === "session",
    );
    expect((cursorUpsert![0] as { extraProps: Record<string, unknown> }).extraProps).toMatchObject({
      logByteOffset: 1_148_676,
      chunkCount: 2,
    });
  });

  it("clears stale chunks and re-indexes from 0 when the log was truncated", async () => {
    kg.getReferenceNodeProps.mockResolvedValue({
      id: "sess-node",
      workspaceId: "w",
      label: "[Session] x",
      logByteOffset: 500,
      chunkCount: 9,
    });
    // Log shrank: readLogFrom reset to offset 0 → nextOffset < byteOffset.
    core.readLogFrom.mockReturnValue({ content: "raw jsonl", nextOffset: 40 });
    kg.ingest.mockResolvedValue([{ text: "fresh", index: 0, vector: [0.3] }]);

    const created = await projectSessionTranscript(session(), embedder);
    expect(created).toBe(1);

    // Stale chunk nodes are bulk-deleted before re-ingestion.
    expect(kg.deleteReferenceNodesByPrefix).toHaveBeenCalledWith("transcript_chunk", "s1#");

    // New chunk re-indexed from 0 (not continuing from the stale chunkCount=9).
    const chunkUpserts = kg.upsertReferenceNode.mock.calls.filter(
      ([input]) => (input as { sourceType: string }).sourceType === "transcript_chunk",
    );
    expect(chunkUpserts.map(([i]) => (i as { sourceId: string }).sourceId)).toEqual(["s1#0"]);

    // Cursor reset to the new offset + recomputed chunk count.
    const cursorUpsert = kg.upsertReferenceNode.mock.calls.find(
      ([input]) => (input as { sourceType: string }).sourceType === "session",
    );
    expect((cursorUpsert![0] as { extraProps: Record<string, unknown> }).extraProps).toMatchObject({
      logByteOffset: 40,
      chunkCount: 1,
    });
  });
});

describe("unprojectSessionTranscript", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bulk-deletes the session's chunks by prefix", async () => {
    const removed = await unprojectSessionTranscript("s1");
    expect(kg.deleteReferenceNodesByPrefix).toHaveBeenCalledWith("transcript_chunk", "s1#");
    expect(removed).toBe(3);
  });
});
