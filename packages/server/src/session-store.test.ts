import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock ./db.js to use our in-memory test database ──────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

import * as sessionStore from "./session-store.js";
import { sqlite } from "./test-db.js";

/** Apply the schema DDL to the in-memory database. */
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
      parent_session_id  TEXT NOT NULL DEFAULT ''
    );
  `);

  // Seed a test environment for FK references
  sqlite.exec("INSERT OR IGNORE INTO environments (id) VALUES ('test-env')");
}

describe("session-store", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
  });

  describe("hibernateSession", () => {
    it("sets status to hibernating and endedAt", () => {
      sessionStore.createSession("s1", "test-env", "claude-code", "test", "model", "/tmp/log");
      const before = sessionStore.getSession("s1");
      expect(before?.status).toBe("pending");
      expect(before?.endedAt).toBeNull();

      sessionStore.hibernateSession("s1");

      const after = sessionStore.getSession("s1");
      expect(after?.status).toBe("hibernating");
      expect(after?.endedAt).toBeTruthy();
    });
  });

  describe("getChildSessions", () => {
    it("returns child sessions ordered by startedAt then id", () => {
      sessionStore.createSession("child-b", "test-env", "claude-code", "b", "model", "/tmp/b", "", "", "parent-1");
      sessionStore.createSession("child-a", "test-env", "claude-code", "a", "model", "/tmp/a", "", "", "parent-1");
      sessionStore.createSession("unrelated", "test-env", "claude-code", "x", "model", "/tmp/x", "", "", "parent-2");

      // Force distinct started_at values so ordering is deterministic
      sqlite.exec("UPDATE sessions SET started_at = '2026-01-01 00:00:02' WHERE id = 'child-b'");
      sqlite.exec("UPDATE sessions SET started_at = '2026-01-01 00:00:01' WHERE id = 'child-a'");

      const children = sessionStore.getChildSessions("parent-1");
      expect(children).toHaveLength(2);
      // child-a has earlier startedAt → comes first
      expect(children.map((c) => c.id)).toEqual(["child-a", "child-b"]);
    });

    it("returns empty array when no children exist", () => {
      const children = sessionStore.getChildSessions("nonexistent");
      expect(children).toEqual([]);
    });
  });

  describe("createSession with parentSessionId", () => {
    it("persists parentSessionId", () => {
      sessionStore.createSession("child-1", "test-env", "claude-code", "test", "model", "/tmp/log", "", "", "parent-1");
      const session = sessionStore.getSession("child-1");
      expect(session?.parentSessionId).toBe("parent-1");
    });

    it("defaults parentSessionId to empty string", () => {
      sessionStore.createSession("orphan", "test-env", "claude-code", "test", "model", "/tmp/log");
      const session = sessionStore.getSession("orphan");
      expect(session?.parentSessionId).toBe("");
    });
  });
});
