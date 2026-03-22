/**
 * Tests for session recovery on environment reconnect.
 * Covers: drain + reanimate, empty drain, reanimate failure, concurrent lock,
 * and the "server died" scenario (RUNNING/IDLE sessions in DB).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock dependencies before importing ──────────────────────

vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./log-writer.js", () => ({
  initLog: vi.fn(),
  ensureLogInitialized: vi.fn(),
  writeEvent: vi.fn(),
  endSession: vi.fn(),
  readLog: vi.fn(() => []),
}));

vi.mock("./stream-hub.js", () => ({
  publish: vi.fn(),
  createStream: vi.fn(() => {
    const iter = (async function* () {})();
    return Object.assign(iter, { cancel: vi.fn() });
  }),
  createGlobalStream: vi.fn(() => {
    const iter = (async function* () {})();
    return Object.assign(iter, { cancel: vi.fn() });
  }),
}));

vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

vi.mock("./transcript.js", () => ({
  writeTranscript: vi.fn(),
}));

// Mock reanimate so we can control success/failure without needing full adapter stack
vi.mock("./reanimate-agent.js", () => ({
  reanimateAgent: vi.fn(),
}));

// ── Imports (after mocks) ───────────────────────────────────

import { sqlite } from "./test-db.js";
import * as sessionStore from "./session-store.js";
import * as logWriter from "./log-writer.js";
import { reanimateAgent } from "./reanimate-agent.js";
import { emit } from "./event-bus.js";
import { recoverSuspendedSessions, _resetForTesting } from "./session-recovery.js";
import { SESSION_STATUS } from "@grackle-ai/common";
import type { PowerLineConnection } from "@grackle-ai/adapter-sdk";

// ── Schema ──────────────────────────────────────────────────

function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      adapter_type TEXT NOT NULL DEFAULT 'local',
      adapter_config TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'disconnected',
      bootstrapped INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'not_started',
      parent_task_id TEXT DEFAULT NULL,
      depth INTEGER NOT NULL DEFAULT 0,
      persona_id TEXT NOT NULL DEFAULT '',
      issue_url TEXT NOT NULL DEFAULT '',
      pr_url TEXT NOT NULL DEFAULT '',
      depends_on TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      env_id TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'stub',
      runtime_session_id TEXT DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'sonnet',
      status TEXT NOT NULL DEFAULT 'pending',
      log_path TEXT NOT NULL DEFAULT '',
      turns INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      suspended_at TEXT,
      ended_at TEXT,
      error TEXT,
      task_id TEXT NOT NULL DEFAULT '',
      persona_id TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      pipe_mode TEXT NOT NULL DEFAULT '',
      parent_session_id TEXT NOT NULL DEFAULT '',
      pipe_fd INTEGER
    );
    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL DEFAULT '',
      task_id TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO environments (id, name, adapter_type, status) VALUES ('env1', 'Test Env', 'local', 'connected');
  `);
}

// ── Helpers ─────────────────────────────────────────────────

/** Create a mock PowerLine connection with controllable drain stream. */
function makeConnection(drainEvents: Array<{ type: string; timestamp: string; content: string }> = []): PowerLineConnection {
  return {
    client: {
      drainBufferedEvents: vi.fn(() => (async function* () {
        for (const event of drainEvents) {
          yield { sessionId: "", type: event.type, timestamp: event.timestamp, content: event.content, raw: "" };
        }
      })()),
      resume: vi.fn(() => (async function* () {})()),
    },
    environmentId: "env1",
    port: 7433,
  } as unknown as PowerLineConnection;
}

// ── Tests ───────────────────────────────────────────────────

describe("session recovery", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS tasks");
    sqlite.exec("DROP TABLE IF EXISTS workspaces");
    sqlite.exec("DROP TABLE IF EXISTS findings");
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
    vi.clearAllMocks();
    _resetForTesting();
  });

  it("drains buffered events and reanimates a suspended session", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.suspendSession("sess1");

    const conn = makeConnection([
      { type: "text", timestamp: "t1", content: "buffered event" },
    ]);

    await recoverSuspendedSessions("env1", conn);

    // Drain should have been called
    expect(conn.client.drainBufferedEvents).toHaveBeenCalled();
    // Events should have been written to log
    expect(logWriter.writeEvent).toHaveBeenCalled();
    // Log stream should be closed
    expect(logWriter.endSession).toHaveBeenCalled();
    // Session should have been reanimated
    expect(reanimateAgent).toHaveBeenCalledWith("sess1");
  });

  it("handles empty drain (PowerLine restarted, no buffered events)", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.suspendSession("sess1");

    const conn = makeConnection([]); // no buffered events

    await recoverSuspendedSessions("env1", conn);

    expect(conn.client.drainBufferedEvents).toHaveBeenCalled();
    expect(logWriter.writeEvent).not.toHaveBeenCalled();
    expect(reanimateAgent).toHaveBeenCalledWith("sess1");
  });

  it("marks session FAILED when reanimate throws", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.suspendSession("sess1");

    vi.mocked(reanimateAgent).mockImplementationOnce(() => {
      throw new Error("SDK session expired");
    });

    const conn = makeConnection([]);
    await recoverSuspendedSessions("env1", conn);

    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe(SESSION_STATUS.FAILED);
    expect(session?.error).toContain("SDK session expired");
  });

  it("skips recovery when no suspended sessions exist", async () => {
    const conn = makeConnection([]);
    await recoverSuspendedSessions("env1", conn);

    expect(conn.client.drainBufferedEvents).not.toHaveBeenCalled();
    expect(reanimateAgent).not.toHaveBeenCalled();
  });

  it("prevents concurrent recovery for the same environment", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.suspendSession("sess1");

    // Make reanimate take time by using a slow mock
    vi.mocked(reanimateAgent).mockImplementation(() => {
      return {} as ReturnType<typeof reanimateAgent>;
    });

    const conn = makeConnection([]);

    // Start two recoveries concurrently
    const p1 = recoverSuspendedSessions("env1", conn);
    const p2 = recoverSuspendedSessions("env1", conn);

    await Promise.all([p1, p2]);

    // Reanimate should only be called once (second call skipped)
    expect(reanimateAgent).toHaveBeenCalledTimes(1);
  });

  it("recovers RUNNING sessions left over from server restart", async () => {
    // Simulate: server died while session was RUNNING, never got suspended
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    // Session is in RUNNING state (default after create + processEventStream sets it)
    sqlite.exec("UPDATE sessions SET status = 'running', runtime_session_id = 'rt-abc' WHERE id = 'sess1'");

    const conn = makeConnection([]);
    await recoverSuspendedSessions("env1", conn);

    // Session should have been suspended first (so reanimate accepts it),
    // then reanimated
    expect(reanimateAgent).toHaveBeenCalledWith("sess1");
  });

  it("closes log stream even when drain fails mid-stream", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.suspendSession("sess1");

    const conn = {
      client: {
        drainBufferedEvents: vi.fn(() => (async function* () {
          throw new Error("transport error mid-drain");
        })()),
      },
      environmentId: "env1",
      port: 7433,
    } as unknown as PowerLineConnection;

    await recoverSuspendedSessions("env1", conn);

    // Log stream should still be closed (finally block)
    expect(logWriter.endSession).toHaveBeenCalled();
    // Should still attempt reanimate despite drain failure
    expect(reanimateAgent).toHaveBeenCalledWith("sess1");
  });
});
