import { describe, it, expect, beforeEach, vi } from "vitest";

// Replace the production db module with the in-memory test db before imports.
vi.mock("./db.js", async () => await import("./test-db.js"));

import { sqlite } from "./test-db.js";
import { persistSessionAction, querySessionActions } from "./session-action-store.js";

/** Create the session_actions table (mirrors db.ts baseline + index). */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS session_actions (
      seq         TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      type        TEXT NOT NULL,
      content     TEXT NOT NULL,
      raw         TEXT NOT NULL DEFAULT '',
      timestamp   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_actions_session ON session_actions(session_id, seq);
  `);
}

/** Seed a session action with explicit seq/session. */
function seed(seq: string, sessionId: string, content: string): void {
  persistSessionAction({ seq, sessionId, type: "text", content, raw: "", timestamp: "2026-05-24T00:00:00.000Z" });
}

describe("querySessionActions", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS session_actions");
    applySchema();
  });

  it("returns a session's actions oldest first (replay order), regardless of insertion order", () => {
    seed("01C", "s1", "c");
    seed("01A", "s1", "a");
    seed("01B", "s1", "b");
    expect(querySessionActions({ sessionId: "s1" }).map((a) => a.seq)).toEqual(["01A", "01B", "01C"]);
  });

  it("scopes results to the requested session", () => {
    seed("01A", "s1", "a");
    seed("01B", "s2", "b");
    seed("01C", "s1", "c");
    expect(querySessionActions({ sessionId: "s1" }).map((a) => a.seq)).toEqual(["01A", "01C"]);
  });

  it("fromSeq resumes after a cursor (exclusive), ascending", () => {
    seed("01A", "s1", "a");
    seed("01B", "s1", "b");
    seed("01C", "s1", "c");
    expect(querySessionActions({ sessionId: "s1", fromSeq: "01A" }).map((a) => a.seq)).toEqual(["01B", "01C"]);
    expect(querySessionActions({ sessionId: "s1", fromSeq: "01C" })).toEqual([]);
  });

  it("caps results at the requested limit, oldest first", () => {
    seed("01A", "s1", "a");
    seed("01B", "s1", "b");
    seed("01C", "s1", "c");
    seed("01D", "s1", "d");
    expect(querySessionActions({ sessionId: "s1", limit: 2 }).map((a) => a.seq)).toEqual(["01A", "01B"]);
  });

  it("round-trips action fields including raw", () => {
    persistSessionAction({
      seq: "01A",
      sessionId: "s1",
      type: "tool_use",
      content: "ran a tool",
      raw: '{"name":"bash"}',
      timestamp: "2026-05-24T00:00:00.000Z",
    });
    const [row] = querySessionActions({ sessionId: "s1" });
    expect(row).toMatchObject({
      seq: "01A",
      sessionId: "s1",
      type: "tool_use",
      content: "ran a tool",
      raw: '{"name":"bash"}',
    });
  });

  it("returns [] when fromSeq is past the last action", () => {
    seed("01A", "s1", "a");
    seed("01B", "s1", "b");
    // A cursor lexicographically after every stored ULID yields nothing.
    expect(querySessionActions({ sessionId: "s1", fromSeq: "ZZZZZZZZZZZZZZZZZZZZZZZZZZ" })).toEqual([]);
  });

  it("clamps a limit above the hard cap to MAX_SESSION_ACTION_LIMIT (5000)", () => {
    // MAX_SESSION_ACTION_LIMIT is 5000 (see session-action-store.ts). Insert one
    // more than the cap and request far above it: the result must be capped.
    const MAX: number = 5000;
    const insert = sqlite.prepare(
      "INSERT INTO session_actions (seq, session_id, type, content, raw, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertMany = sqlite.transaction((count: number) => {
      for (let i = 0; i < count; i++) {
        // Zero-padded so lexical ULID order matches insertion order.
        insert.run(`SEQ${String(i).padStart(6, "0")}`, "big", "text", "x", "", "2026-05-24T00:00:00.000Z");
      }
    });
    insertMany(MAX + 1);
    expect(querySessionActions({ sessionId: "big", limit: MAX + 1000 })).toHaveLength(MAX);
  });
});
