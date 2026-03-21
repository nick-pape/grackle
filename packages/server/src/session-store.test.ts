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
      parent_session_id  TEXT NOT NULL DEFAULT '',
      pipe_mode          TEXT NOT NULL DEFAULT ''
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
      // Insert with explicit timestamps to ensure deterministic ordering
      sqlite.exec(`
        INSERT INTO sessions (id, env_id, runtime, prompt, model, log_path, task_id, persona_id, parent_session_id, pipe_mode, started_at)
        VALUES
          ('child-b', 'test-env', 'claude-code', 'b', 'model', '/tmp/b', '', '', 'parent-1', '', '2026-01-01T00:00:01.000Z'),
          ('child-a', 'test-env', 'claude-code', 'a', 'model', '/tmp/a', '', '', 'parent-1', '', '2026-01-01T00:00:02.000Z'),
          ('unrelated', 'test-env', 'claude-code', 'x', 'model', '/tmp/x', '', '', 'parent-2', '', '2026-01-01T00:00:03.000Z')
      `);

      const children = sessionStore.getChildSessions("parent-1");
      expect(children).toHaveLength(2);
      // child-b started earlier → comes first; child-a second
      expect(children.map((c) => c.id)).toEqual(["child-b", "child-a"]);
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

  describe("createSession with pipeMode", () => {
    it("persists pipeMode", () => {
      sessionStore.createSession("piped", "test-env", "claude-code", "test", "model", "/tmp/log", "", "", "", "async");
      const session = sessionStore.getSession("piped");
      expect(session?.pipeMode).toBe("async");
    });

    it("defaults pipeMode to empty string", () => {
      sessionStore.createSession("unpiped", "test-env", "claude-code", "test", "model", "/tmp/log");
      const session = sessionStore.getSession("unpiped");
      expect(session?.pipeMode).toBe("");
    });
  });
});
