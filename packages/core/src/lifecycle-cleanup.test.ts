import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { openDatabase, initDatabase, sqlite as _sqlite, sessionStore } from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
const sqlite = _sqlite!;
import * as streamRegistry from "./stream-registry.js";
import { lifecycleCleanupPhase } from "./lifecycle-cleanup.js";

function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id          TEXT PRIMARY KEY,
      adapter     TEXT NOT NULL DEFAULT 'local',
      config      TEXT NOT NULL DEFAULT '{}',
      status      TEXT NOT NULL DEFAULT 'disconnected',
      host        TEXT NOT NULL DEFAULT '',
      port        INTEGER NOT NULL DEFAULT 0,
      powerline_token TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id                 TEXT PRIMARY KEY,
      env_id             TEXT NOT NULL DEFAULT '' REFERENCES environments(id),
      runtime            TEXT NOT NULL DEFAULT '',
      runtime_session_id TEXT,
      prompt             TEXT NOT NULL DEFAULT '',
      model              TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'pending',
      log_path           TEXT,
      turns              INTEGER NOT NULL DEFAULT 0,
      started_at         TEXT NOT NULL DEFAULT (datetime('now')),
      suspended_at       TEXT,
      ended_at           TEXT,
      error              TEXT,
      task_id            TEXT NOT NULL DEFAULT '',
      persona_id         TEXT NOT NULL DEFAULT '',
      parent_session_id  TEXT NOT NULL DEFAULT '',
      pipe_mode          TEXT NOT NULL DEFAULT '',
      input_tokens       INTEGER NOT NULL DEFAULT 0,
      output_tokens      INTEGER NOT NULL DEFAULT 0,
      cost_usd           REAL NOT NULL DEFAULT 0,
      end_reason         TEXT,
      sigterm_sent_at    TEXT
    );
  `);
  sqlite.exec("INSERT OR IGNORE INTO environments (id) VALUES ('test-env')");
}

describe("lifecycleCleanupPhase", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
    streamRegistry._resetForTesting();
  });

  it("removes lifecycle streams whose session is deleted from DB", async () => {
    // Create a lifecycle stream for a session that doesn't exist in the DB
    const stream = streamRegistry.createStream("lifecycle:deleted-sess");
    streamRegistry.subscribe(stream.id, "deleted-sess", "rw", "detach", false);

    await lifecycleCleanupPhase.execute();

    expect(streamRegistry.getStreamByName("lifecycle:deleted-sess")).toBeUndefined();
  });

  it("does NOT remove lifecycle streams for existing sessions", async () => {
    sessionStore.createSession("alive-sess", "test-env", "claude-code", "test", "sonnet", "/tmp/log");

    const stream = streamRegistry.createStream("lifecycle:alive-sess");
    streamRegistry.subscribe(stream.id, "alive-sess", "rw", "detach", false);

    await lifecycleCleanupPhase.execute();

    expect(streamRegistry.getStreamByName("lifecycle:alive-sess")).toBeDefined();
  });

  it("does NOT remove non-lifecycle streams", async () => {
    const stream = streamRegistry.createStream("custom-pipe");
    streamRegistry.subscribe(stream.id, "some-sess", "rw", "detach", false);

    await lifecycleCleanupPhase.execute();

    expect(streamRegistry.getStreamByName("custom-pipe")).toBeDefined();
  });

  it("handles empty stream list gracefully", async () => {
    // No streams at all — should not throw
    await expect(lifecycleCleanupPhase.execute()).resolves.toBeUndefined();
  });
});
