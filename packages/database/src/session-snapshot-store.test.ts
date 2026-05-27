import { describe, it, expect, beforeEach, vi } from "vitest";

// Replace the production db module with the in-memory test db before imports.
vi.mock("./db.js", async () => await import("./test-db.js"));

import { sqlite } from "./test-db.js";
import { persistSnapshot, querySnapshot, type SnapshotRecord } from "./session-snapshot-store.js";

/** Create the session_snapshots table with composite PK (mirrors migration v17 + v18). */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS session_snapshots (
      session_id     TEXT NOT NULL,
      seq            TEXT NOT NULL,
      snapshot_at    TEXT NOT NULL,
      state          TEXT NOT NULL,
      mapper_context TEXT,
      PRIMARY KEY (session_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_session_snapshots_session
      ON session_snapshots(session_id, seq DESC);
  `);
}

/** Seed a snapshot with explicit seq/session. */
function seed(seq: string, sessionId: string, state: string): SnapshotRecord {
  const record: SnapshotRecord = {
    seq,
    sessionId,
    snapshotAt: "2026-05-27T00:00:00.000Z",
    state,
  };
  persistSnapshot(record);
  return record;
}

describe("session-snapshot-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS session_snapshots");
    applySchema();
  });

  // ─── PK collision ──────────────────────────────────────────────

  it("writes two snapshots for different sessions with the same seq value", () => {
    // Both sessions use seq "0" — with composite PK (session_id, seq),
    // this should succeed (no PRIMARY KEY collision).
    seed("0", "session-a", JSON.stringify({ lifecycle: "creating", turns: [] }));
    seed("0", "session-b", JSON.stringify({ lifecycle: "creating", turns: [] }));

    // Verify both persisted
    const rowsA = querySnapshot("session-a");
    const rowsB = querySnapshot("session-b");
    expect(rowsA.length).toBe(1);
    expect(rowsB.length).toBe(1);
    expect(rowsA[0].seq).toBe("0");
    expect(rowsB[0].seq).toBe("0");
  });

  it("overwrites same session + same seq (INSERT OR REPLACE semantics)", () => {
    seed("1", "session-x", JSON.stringify({ lifecycle: "creating" }));

    // Overwrite with same seq — should succeed via INSERT OR REPLACE
    seed("1", "session-x", JSON.stringify({ lifecycle: "ready" }));

    const rows = querySnapshot("session-x");
    expect(rows.length).toBe(1);
    // The overwritten state should reflect the second write
    const parsed = JSON.parse(rows[0].state);
    expect(parsed.lifecycle).toBe("ready");
  });

  // ─── Lexicographic sort ────────────────────────────────────────

  it("querySnapshot returns most recent first with ULID seq ordering", () => {
    const base = "01JK"; // ULID prefix for May 27, 2026
    seed(`${base}0000000000`, "session-1", JSON.stringify({ lifecycle: "creating" }));
    seed(`${base}0000000001`, "session-1", JSON.stringify({ lifecycle: "running" }));
    seed(`${base}0000000002`, "session-1", JSON.stringify({ lifecycle: "ready" }));

    const rows = querySnapshot("session-1");
    expect(rows.length).toBe(3);
    // Most recent (largest ULID) should be first
    const parsed = JSON.parse(rows[0].state);
    expect(parsed.lifecycle).toBe("ready");
  });

  it("querySnapshot ordering with integer-as-string seq is correct for ULID values", () => {
    // ULIDs are designed to sort correctly as TEXT.
    // Write in non-sequential order to verify DESC sort returns newest first.
    seed("01JKAAA000", "session-2", JSON.stringify({ seq: "third" }));
    seed("01JKAAA002", "session-2", JSON.stringify({ seq: "first" }));
    seed("01JKAAA001", "session-2", JSON.stringify({ seq: "second" }));

    const rows = querySnapshot("session-2");
    expect(rows.length).toBe(3);
    // Most recent ULID should be first
    expect(JSON.parse(rows[0].state).seq).toBe("first");
    expect(JSON.parse(rows[1].state).seq).toBe("second");
    expect(JSON.parse(rows[2].state).seq).toBe("third");
  });

  // ─── MapperContext round-trip ──────────────────────────────

  it("round-trips mapperContext alongside state", () => {
    const ctx = {
      turnId: "turn-abc",
      openToolCalls: ["tc-1", "tc-2"],
      partCounter: 7,
      metaAccumulator: { costMillicents: 500 },
    };
    persistSnapshot({
      seq: "01JKAAA010",
      sessionId: "session-ctx",
      snapshotAt: "2026-05-27T00:00:00.000Z",
      state: JSON.stringify({ lifecycle: "ready" }),
      mapperContext: JSON.stringify(ctx),
    });

    const rows = querySnapshot("session-ctx");
    expect(rows.length).toBe(1);
    expect(rows[0].mapperContext).toBeDefined();
    const parsed = JSON.parse(rows[0].mapperContext!);
    expect(parsed.turnId).toBe("turn-abc");
    expect(parsed.openToolCalls).toEqual(["tc-1", "tc-2"]);
    expect(parsed.partCounter).toBe(7);
    expect(parsed.metaAccumulator.costMillicents).toBe(500);
  });

  it("round-trips null mapperContext for snapshots without context", () => {
    persistSnapshot({
      seq: "01JKAAA020",
      sessionId: "session-no-ctx",
      snapshotAt: "2026-05-27T00:00:00.000Z",
      state: JSON.stringify({ lifecycle: "creating" }),
    });

    const rows = querySnapshot("session-no-ctx");
    expect(rows.length).toBe(1);
    expect(rows[0].mapperContext).toBeNull();
  });
});
