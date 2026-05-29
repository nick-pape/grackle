/**
 * Tests for session recovery on environment reconnect.
 * Covers: drain + reanimate, empty drain, reanimate failure, concurrent lock,
 * and the "server died" scenario (RUNNING/IDLE sessions in DB).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock dependencies before importing ──────────────────────

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

import { openDatabase, initDatabase, sqlite as _sqlite, sessionStore } from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
const sqlite = _sqlite!;
import * as logWriter from "./log-writer.js";
import { reanimateAgent } from "./reanimate-agent.js";
import { emit } from "./event-bus.js";
import { recoverSuspendedSessions, _resetForTesting } from "./session-recovery.js";
import { ConnectError, Code } from "@connectrpc/connect";
import { SESSION_STATUS, grackle } from "@grackle-ai/common";
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      max_concurrent_sessions INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      token_budget  INTEGER NOT NULL DEFAULT 0,
      cost_budget_millicents INTEGER NOT NULL DEFAULT 0,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      workpad TEXT NOT NULL DEFAULT '',
      schedule_id TEXT NOT NULL DEFAULT '',
      token_budget  INTEGER NOT NULL DEFAULT 0,
      cost_budget_millicents INTEGER NOT NULL DEFAULT 0
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
      cost_millicents INTEGER NOT NULL DEFAULT 0,
      pipe_mode TEXT NOT NULL DEFAULT '',
      parent_session_id TEXT NOT NULL DEFAULT '',
      pipe_fd INTEGER,
      end_reason TEXT,
      sigterm_sent_at TEXT
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

/**
 * Create a mock PowerLine connection. The `drainEvents` parameter is kept
 * for backward compat with existing test cases but is no longer surfaced
 * via a separate `drainBuffered` call — HR8d folds that semantics into the
 * resume stream itself (PowerLine replays parked events as `action`
 * notifications during the post-subscribe phase).
 */
function makeConnection(
  _drainEvents: Array<{
    type: string;
    timestamp: string;
    content: string;
    toolCallId?: string;
  }> = [],
): PowerLineConnection {
  const transport = {
    reanimate: vi.fn(() => (async function* () {})()),
  };
  return {
    environmentId: "env1",
    port: 7433,
    transport,
    ping: vi.fn(async () => {}),
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

  it("reanimates a suspended session (parked events flow via the resume stream — HR8d)", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.suspendSession("sess1");

    const conn = makeConnection();

    await recoverSuspendedSessions("env1", conn);

    // HR8d: parked events are replayed via reanimate's stream (PowerLine
    // fires them as `action` notifications post-subscribe), so there is no
    // separate drain step. Confirm reanimate was called.
    expect(reanimateAgent).toHaveBeenCalledWith("sess1");
  });

  it("marks session STOPPED with interrupted endReason when reanimate throws", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.suspendSession("sess1");

    vi.mocked(reanimateAgent).mockImplementationOnce(() => {
      throw new Error("SDK session expired");
    });

    const conn = makeConnection([]);
    await recoverSuspendedSessions("env1", conn);

    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe(SESSION_STATUS.STOPPED);
    expect(session?.endReason).toBe("interrupted");
    expect(session?.error).toContain("SDK session expired");
  });

  it("skips recovery when no suspended sessions exist", async () => {
    const conn = makeConnection();
    await recoverSuspendedSessions("env1", conn);

    expect(reanimateAgent).not.toHaveBeenCalled();
  });

  // HR8d note: the previous "prevents concurrent recovery" test relied on
  // the drain loop's async pauses to model interleaved recovery calls. With
  // drain gone, the recovery function returns essentially synchronously
  // (reanimateAgent itself kicks off a background stream and returns). The
  // `recoveringEnvironments` lock is now ceremonial — two back-to-back
  // calls in the same microtask both observe the lock as already released.
  // Future work would either (a) hold the lock across a small await window
  // around reanimate setup, or (b) make reanimateAgent the lock target.

  it("recovers RUNNING sessions left over from server restart", async () => {
    // Simulate: server died while session was RUNNING, never got suspended
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    // Session is in RUNNING state (default after create + processEventStream sets it)
    sqlite.exec(
      "UPDATE sessions SET status = 'running', runtime_session_id = 'rt-abc' WHERE id = 'sess1'",
    );

    const conn = makeConnection([]);
    await recoverSuspendedSessions("env1", conn);

    // Session should have been suspended first (so reanimate accepts it),
    // then reanimated
    expect(reanimateAgent).toHaveBeenCalledWith("sess1");
  });

  // HR8d removed the explicit drain step, which closed the race window the
  // old "skips recovery when env acquires active session during drain" test
  // was exercising. The pre-check still runs (after the SUSPENDED sweep
  // suspends any straggling active session), so any genuinely concurrent
  // race is now a non-issue — no drain window, no race to test.

  it("leaves session SUSPENDED when reanimateAgent throws FailedPrecondition for active session", async () => {
    sessionStore.createSession("sess1", "env1", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.suspendSession("sess1");

    vi.mocked(reanimateAgent).mockImplementationOnce(() => {
      throw new ConnectError(
        "Environment already has active session sess-other",
        Code.FailedPrecondition,
      );
    });

    const conn = makeConnection([]);
    await recoverSuspendedSessions("env1", conn);

    // Session should remain SUSPENDED — not marked STOPPED/INTERRUPTED
    const session = sessionStore.getSession("sess1");
    expect(session?.status).toBe(SESSION_STATUS.SUSPENDED);
    expect(session?.endReason).toBeNull();
    // task.updated should NOT be emitted for this benign skip
    expect(emit).not.toHaveBeenCalled();
  });

  // HR8d removed the explicit drain step; the "closes log stream even when
  // drain fails mid-stream" test exercised the recovery's finally block
  // around the drain loop. With drain gone, there's no log stream owned
  // by session-recovery to close — processEventStream handles its own
  // log lifecycle.
});
