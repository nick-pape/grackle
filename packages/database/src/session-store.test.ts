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
      pipe_mode          TEXT NOT NULL DEFAULT '',
      input_tokens       INTEGER NOT NULL DEFAULT 0,
      output_tokens      INTEGER NOT NULL DEFAULT 0,
      cost_usd           REAL NOT NULL DEFAULT 0,
      end_reason         TEXT,
      sigterm_sent_at    TEXT
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

  describe("updateSession to STOPPED", () => {
    it("sets status to stopped and endedAt", () => {
      sessionStore.createSession("s1", "test-env", "claude-code", "test", "model", "/tmp/log");
      const before = sessionStore.getSession("s1");
      expect(before?.status).toBe("pending");
      expect(before?.endedAt).toBeNull();

      sessionStore.updateSession("s1", "stopped", undefined, undefined, "completed");

      const after = sessionStore.getSession("s1");
      expect(after?.status).toBe("stopped");
      expect(after?.endedAt).toBeTruthy();
      expect(after?.endReason).toBe("completed");
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

  describe("updateSessionUsage", () => {
    it("stores usage values on first call", () => {
      sessionStore.createSession("usage-1", "test-env", "claude-code", "test", "model", "/tmp/log");
      sessionStore.updateSessionUsage("usage-1", 100, 50, 0.005);
      const session = sessionStore.getSession("usage-1");
      expect(session?.inputTokens).toBe(100);
      expect(session?.outputTokens).toBe(50);
      expect(session?.costUsd).toBeCloseTo(0.005);
    });

    it("accumulates values on subsequent calls", () => {
      sessionStore.createSession("usage-2", "test-env", "claude-code", "test", "model", "/tmp/log");
      sessionStore.updateSessionUsage("usage-2", 100, 50, 0.005);
      sessionStore.updateSessionUsage("usage-2", 200, 75, 0.010);
      const session = sessionStore.getSession("usage-2");
      expect(session?.inputTokens).toBe(300);
      expect(session?.outputTokens).toBe(125);
      expect(session?.costUsd).toBeCloseTo(0.015);
    });

    it("handles fractional cost values precisely", () => {
      sessionStore.createSession("usage-3", "test-env", "claude-code", "test", "model", "/tmp/log");
      sessionStore.updateSessionUsage("usage-3", 0, 0, 0.001234);
      sessionStore.updateSessionUsage("usage-3", 0, 0, 0.005678);
      const session = sessionStore.getSession("usage-3");
      expect(session?.costUsd).toBeCloseTo(0.006912, 6);
    });

    it("defaults to zero when no usage has been recorded", () => {
      sessionStore.createSession("usage-4", "test-env", "claude-code", "test", "model", "/tmp/log");
      const session = sessionStore.getSession("usage-4");
      expect(session?.inputTokens).toBe(0);
      expect(session?.outputTokens).toBe(0);
      expect(session?.costUsd).toBe(0);
    });
  });

  describe("setSigtermSentAt", () => {
    it("sets sigterm_sent_at timestamp on a session", () => {
      sessionStore.createSession("sig-1", "test-env", "claude-code", "test", "model", "/tmp/log");
      sessionStore.setSigtermSentAt("sig-1");
      const session = sessionStore.getSession("sig-1");
      expect(session?.sigtermSentAt).toBeTruthy();
    });

    it("returns sigtermSentAt as null by default", () => {
      sessionStore.createSession("sig-2", "test-env", "claude-code", "test", "model", "/tmp/log");
      const session = sessionStore.getSession("sig-2");
      expect(session?.sigtermSentAt).toBeNull();
    });
  });

  describe("aggregateUsage", () => {
    it("aggregates by taskId", () => {
      sessionStore.createSession("agg-1", "test-env", "claude-code", "test", "model", "/tmp/log", "task-a");
      sessionStore.createSession("agg-2", "test-env", "claude-code", "test", "model", "/tmp/log", "task-a");
      sessionStore.updateSessionUsage("agg-1", 100, 10, 0.01);
      sessionStore.updateSessionUsage("agg-2", 200, 20, 0.02);
      const result = sessionStore.aggregateUsage({ taskId: "task-a" });
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(30);
      expect(result.costUsd).toBeCloseTo(0.03);
      expect(result.sessionCount).toBe(2);
    });

    it("aggregates by taskIds", () => {
      sessionStore.createSession("agg-3", "test-env", "claude-code", "test", "model", "/tmp/log", "task-b");
      sessionStore.createSession("agg-4", "test-env", "claude-code", "test", "model", "/tmp/log", "task-c");
      sessionStore.updateSessionUsage("agg-3", 50, 5, 0.005);
      sessionStore.updateSessionUsage("agg-4", 75, 8, 0.008);
      const result = sessionStore.aggregateUsage({ taskIds: ["task-b", "task-c"] });
      expect(result.inputTokens).toBe(125);
      expect(result.outputTokens).toBe(13);
      expect(result.costUsd).toBeCloseTo(0.013);
      expect(result.sessionCount).toBe(2);
    });

    it("aggregates by environmentId", () => {
      sessionStore.createSession("agg-5", "test-env", "claude-code", "test", "model", "/tmp/log");
      sessionStore.updateSessionUsage("agg-5", 500, 50, 0.05);
      const result = sessionStore.aggregateUsage({ environmentId: "test-env" });
      expect(result.inputTokens).toBe(500);
      expect(result.outputTokens).toBe(50);
      expect(result.costUsd).toBeCloseTo(0.05);
      expect(result.sessionCount).toBe(1);
    });

    it("returns zeros when no sessions match", () => {
      const result = sessionStore.aggregateUsage({ taskId: "nonexistent" });
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.costUsd).toBe(0);
      expect(result.sessionCount).toBe(0);
    });
  });
});
