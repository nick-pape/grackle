import { describe, it, expect, beforeEach, vi } from "vitest";

// Replace the production db module with the in-memory test db before imports.
vi.mock("./db.js", async () => await import("./test-db.js"));

import { sqlite } from "./test-db.js";
import { persistStreamMessage, queryStreamMessages } from "./stream-message-store.js";

/** Create the stream_messages table (mirrors db.ts baseline + index). */
function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS stream_messages (
      seq        TEXT PRIMARY KEY,
      stream_id  TEXT NOT NULL,
      sender_id  TEXT NOT NULL,
      content    TEXT NOT NULL,
      timestamp  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stream_messages_stream ON stream_messages(stream_id, seq);
  `);
}

/** Seed a stream message with explicit seq/stream. */
function seed(seq: string, streamId: string, content: string): void {
  persistStreamMessage({
    seq,
    streamId,
    senderId: "sess-1",
    content,
    timestamp: "2026-05-24T00:00:00.000Z",
  });
}

describe("queryStreamMessages", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS stream_messages");
    applySchema();
  });

  it("returns a stream's messages most recent first, regardless of insertion order", () => {
    seed("01C", "s1", "c");
    seed("01A", "s1", "a");
    seed("01B", "s1", "b");
    expect(queryStreamMessages({ streamId: "s1" }).map((m) => m.seq)).toEqual([
      "01C",
      "01B",
      "01A",
    ]);
  });

  it("scopes results to the requested stream", () => {
    seed("01A", "s1", "a");
    seed("01B", "s2", "b");
    seed("01C", "s1", "c");
    expect(queryStreamMessages({ streamId: "s1" }).map((m) => m.seq)).toEqual(["01C", "01A"]);
  });

  it("beforeSeq pages into older messages (exclusive)", () => {
    seed("01A", "s1", "a");
    seed("01B", "s1", "b");
    seed("01C", "s1", "c");
    expect(queryStreamMessages({ streamId: "s1", beforeSeq: "01C" }).map((m) => m.seq)).toEqual([
      "01B",
      "01A",
    ]);
    expect(queryStreamMessages({ streamId: "s1", beforeSeq: "01A" })).toEqual([]);
  });

  it("caps results at the requested limit, most recent first", () => {
    seed("01A", "s1", "a");
    seed("01B", "s1", "b");
    seed("01C", "s1", "c");
    seed("01D", "s1", "d");
    expect(queryStreamMessages({ streamId: "s1", limit: 2 }).map((m) => m.seq)).toEqual([
      "01D",
      "01C",
    ]);
  });

  it("round-trips message fields", () => {
    seed("01A", "s1", "hello world");
    const [row] = queryStreamMessages({ streamId: "s1" });
    expect(row).toMatchObject({
      seq: "01A",
      streamId: "s1",
      senderId: "sess-1",
      content: "hello world",
    });
  });
});
