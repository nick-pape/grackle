import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./stream-hub.js", () => ({
  publish: vi.fn(),
}));

vi.mock("./event-processor.js", () => ({
  processEventStream: vi.fn(),
}));

// ── Imports ─────────────────────────────────────────────────
import { openDatabase, initDatabase, sqlite as _sqlite, sessionStore } from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
const sqlite = _sqlite!;
import * as streamRegistry from "./stream-registry.js";
import * as adapterManager from "./adapter-manager.js";
import {
  createLifecycleSubscriber,
  cleanupLifecycleStream,
  ensureLifecycleStream,
} from "./lifecycle.js";
import type { Disposable, PluginContext } from "./subscriber-types.js";

/** Apply minimal schema. */
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
      max_concurrent_sessions INTEGER NOT NULL DEFAULT 0,
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

/** Create a mock PluginContext for lifecycle subscriber. */
function createMockContext(): PluginContext {
  return {
    subscribe: vi.fn(() => vi.fn()),
    emit: vi.fn(),
  };
}

describe("lifecycle manager", () => {
  let mockKill: ReturnType<typeof vi.fn>;
  let ctx: PluginContext;
  let disposable: Disposable;

  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
    vi.clearAllMocks();
    streamRegistry._resetForTesting();

    ctx = createMockContext();
    disposable = createLifecycleSubscriber(ctx);

    mockKill = vi.fn().mockResolvedValue({});
    vi.spyOn(adapterManager, "getConnection").mockReturnValue({
      client: { kill: mockKill },
    } as unknown as ReturnType<typeof adapterManager.getConnection>);
  });

  afterEach(() => {
    disposable.dispose();
  });

  it("auto-stops session when last subscription removed", () => {
    sessionStore.createSession("sess-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSessionStatus("sess-1", "running");

    // Create lifecycle stream with one subscription
    const stream = streamRegistry.createStream("lifecycle:sess-1");
    const sub = streamRegistry.subscribe(stream.id, "__server__", "rw", "detach", true);
    streamRegistry.subscribe(stream.id, "sess-1", "rw", "detach", false);

    // Remove server's subscription
    streamRegistry.unsubscribe(sub.id);

    // Session's own subscription is still there — not orphaned yet
    const session1 = sessionStore.getSession("sess-1");
    expect(session1?.status).toBe("running");

    // Remove session's own subscription → orphaned → auto-stop
    const sessSub = streamRegistry.getSubscriptionsForSession("sess-1")[0];
    streamRegistry.unsubscribe(sessSub.id);

    const session2 = sessionStore.getSession("sess-1");
    expect(session2?.status).toBe("stopped");
    expect(session2?.endedAt).toBeTruthy();
    expect(session2?.endReason).toBe("killed");
  });

  it("does not stop already-terminal sessions", () => {
    sessionStore.createSession("sess-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSession("sess-1", "stopped", undefined, undefined, "completed");

    const stream = streamRegistry.createStream("lifecycle:sess-1");
    const sub = streamRegistry.subscribe(stream.id, "sess-1", "rw", "detach", false);

    streamRegistry.unsubscribe(sub.id);

    // Should still be stopped with completed reason, not re-stopped
    const session = sessionStore.getSession("sess-1");
    expect(session?.status).toBe("stopped");
    expect(session?.endReason).toBe("completed");
  });

  it("kills PowerLine process on auto-stop", () => {
    sessionStore.createSession("sess-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSessionStatus("sess-1", "idle");

    const stream = streamRegistry.createStream("lifecycle:sess-1");
    const sub = streamRegistry.subscribe(stream.id, "sess-1", "rw", "detach", false);

    streamRegistry.unsubscribe(sub.id);

    expect(mockKill).toHaveBeenCalledOnce();
  });

  it("auto-stops child when all subscriptions removed (parent + child)", () => {
    sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
    sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent");
    sessionStore.updateSessionStatus("child", "idle");

    // Create lifecycle stream for child (parent holds fd)
    const stream = streamRegistry.createStream("lifecycle:child");
    const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "detach", true);
    const childSub = streamRegistry.subscribe(stream.id, "child", "rw", "detach", false);

    // Parent closes its fd
    streamRegistry.unsubscribe(parentSub.id);

    // Child still has its own subscription — not orphaned
    expect(sessionStore.getSession("child")?.status).toBe("idle");

    // Child's subscription removed (e.g., via closeFd or stream cleanup)
    streamRegistry.unsubscribe(childSub.id);

    // Now child is orphaned → auto-stopped (idle → completed end reason)
    expect(sessionStore.getSession("child")?.status).toBe("stopped");
    expect(sessionStore.getSession("child")?.endReason).toBe("completed");
  });

  it("dispose unregisters orphan callback so auto-stop no longer fires", () => {
    // Dispose the lifecycle subscriber registered in beforeEach
    disposable.dispose();

    // Now orphaning a session should NOT auto-stop it (no callback registered)
    sessionStore.createSession("sess-disposed", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSessionStatus("sess-disposed", "running");
    const stream = streamRegistry.createStream("lifecycle:sess-disposed");
    const sub = streamRegistry.subscribe(stream.id, "sess-disposed", "rw", "detach", false);
    streamRegistry.unsubscribe(sub.id);

    // Session should remain running — orphan callback was unregistered
    const session = sessionStore.getSession("sess-disposed");
    expect(session?.status).toBe("running");
  });
});

describe("SIGTERM end reason derivation", () => {
  let mockKill: ReturnType<typeof vi.fn>;
  let ctx: PluginContext;
  let disposable: Disposable;

  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
    vi.clearAllMocks();
    streamRegistry._resetForTesting();

    ctx = createMockContext();
    disposable = createLifecycleSubscriber(ctx);

    mockKill = vi.fn().mockResolvedValue({});
    vi.spyOn(adapterManager, "getConnection").mockReturnValue({
      client: { kill: mockKill },
    } as unknown as ReturnType<typeof adapterManager.getConnection>);
  });

  afterEach(() => {
    disposable.dispose();
  });

  it("sets endReason to terminated when IDLE session has sigtermSentAt", () => {
    sessionStore.createSession("sess-sigterm", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSessionStatus("sess-sigterm", "idle");
    sqlite.exec("UPDATE sessions SET sigterm_sent_at = '2026-01-01T00:00:00Z' WHERE id = 'sess-sigterm'");

    const stream = streamRegistry.createStream("lifecycle:sess-sigterm");
    const sub = streamRegistry.subscribe(stream.id, "sess-sigterm", "rw", "detach", false);

    streamRegistry.unsubscribe(sub.id);

    const session = sessionStore.getSession("sess-sigterm");
    expect(session?.status).toBe("stopped");
    expect(session?.endReason).toBe("terminated");
  });

  it("sets endReason to completed when IDLE session has no sigtermSentAt", () => {
    sessionStore.createSession("sess-normal", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSessionStatus("sess-normal", "idle");

    const stream = streamRegistry.createStream("lifecycle:sess-normal");
    const sub = streamRegistry.subscribe(stream.id, "sess-normal", "rw", "detach", false);

    streamRegistry.unsubscribe(sub.id);

    const session = sessionStore.getSession("sess-normal");
    expect(session?.status).toBe("stopped");
    expect(session?.endReason).toBe("completed");
  });

  it("sets endReason to killed when RUNNING session has sigtermSentAt", () => {
    sessionStore.createSession("sess-running", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSessionStatus("sess-running", "running");
    sqlite.exec("UPDATE sessions SET sigterm_sent_at = '2026-01-01T00:00:00Z' WHERE id = 'sess-running'");

    const stream = streamRegistry.createStream("lifecycle:sess-running");
    const sub = streamRegistry.subscribe(stream.id, "sess-running", "rw", "detach", false);

    streamRegistry.unsubscribe(sub.id);

    const session = sessionStore.getSession("sess-running");
    expect(session?.status).toBe("stopped");
    expect(session?.endReason).toBe("killed");
  });
});

describe("ensureLifecycleStream", () => {
  let mockKill: ReturnType<typeof vi.fn>;
  let ctx: PluginContext;
  let disposable: Disposable;

  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
    vi.clearAllMocks();
    streamRegistry._resetForTesting();

    ctx = createMockContext();
    disposable = createLifecycleSubscriber(ctx);

    mockKill = vi.fn().mockResolvedValue({});
    vi.spyOn(adapterManager, "getConnection").mockReturnValue({
      client: { kill: mockKill },
    } as unknown as ReturnType<typeof adapterManager.getConnection>);
  });

  afterEach(() => {
    disposable.dispose();
  });

  it("creates lifecycle stream when none exists", () => {
    sessionStore.createSession("sess-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSession("sess-1", "stopped", undefined, undefined, "killed");

    ensureLifecycleStream("sess-1", "__server__");

    const stream = streamRegistry.getStreamByName("lifecycle:sess-1");
    expect(stream).toBeDefined();
    expect(stream!.subscriptions.size).toBe(2);

    const subs = Array.from(stream!.subscriptions.values());
    const sessionIds = subs.map((s) => s.sessionId);
    expect(sessionIds).toContain("__server__");
    expect(sessionIds).toContain("sess-1");
  });

  it("is idempotent when lifecycle stream already exists", () => {
    sessionStore.createSession("sess-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSessionStatus("sess-1", "idle");

    // Manually create lifecycle stream (simulates session that went idle naturally)
    const original = streamRegistry.createStream("lifecycle:sess-1");
    streamRegistry.subscribe(original.id, "__server__", "rw", "detach", true);
    streamRegistry.subscribe(original.id, "sess-1", "rw", "detach", false);

    // Should not throw or create duplicates
    ensureLifecycleStream("sess-1", "__server__");

    const stream = streamRegistry.getStreamByName("lifecycle:sess-1");
    expect(stream!.id).toBe(original.id);
    expect(stream!.subscriptions.size).toBe(2);
  });

  it("full cycle — kill then reanimate restores orphan cascade", () => {
    sessionStore.createSession("sess-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSessionStatus("sess-1", "running");

    // Spawn: create lifecycle stream with 2 subs
    const stream = streamRegistry.createStream("lifecycle:sess-1");
    streamRegistry.subscribe(stream.id, "__server__", "rw", "detach", true);
    streamRegistry.subscribe(stream.id, "sess-1", "rw", "detach", false);

    // Kill: cleanup lifecycle stream (simulates killAgent).
    // In real killAgent, status is set to STOPPED before cleanup so the orphan
    // callback skips the status change. Here we do the same.
    sessionStore.updateSession("sess-1", "stopped", undefined, undefined, "killed");
    cleanupLifecycleStream("sess-1");
    expect(streamRegistry.getStreamByName("lifecycle:sess-1")).toBeUndefined();

    // Reset mock — the kill above may have triggered a PowerLine kill call
    mockKill.mockClear();

    // Reanimate: reset DB and recreate lifecycle stream
    sessionStore.reanimateSession("sess-1");
    ensureLifecycleStream("sess-1", "__server__");

    const recreated = streamRegistry.getStreamByName("lifecycle:sess-1");
    expect(recreated).toBeDefined();
    expect(recreated!.subscriptions.size).toBe(2);

    // Verify orphan cascade still works: remove both subs → auto-stop
    const serverSub = Array.from(recreated!.subscriptions.values()).find((s) => s.sessionId === "__server__")!;
    streamRegistry.unsubscribe(serverSub.id);

    // Session still running (one sub remains)
    expect(sessionStore.getSession("sess-1")?.status).toBe("running");

    const sessSub = streamRegistry.getSubscriptionsForSession("sess-1")[0];
    streamRegistry.unsubscribe(sessSub.id);

    // Orphan callback should have fired → session auto-stopped
    const final = sessionStore.getSession("sess-1");
    expect(final?.status).toBe("stopped");
    expect(final?.endReason).toBe("killed");
    expect(mockKill).toHaveBeenCalledOnce();
  });
});

describe("auto-reanimate on subscribe", () => {
  let mockKill: ReturnType<typeof vi.fn>;
  let mockResume: ReturnType<typeof vi.fn>;
  let ctx: PluginContext;
  let disposable: Disposable;

  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
    vi.clearAllMocks();
    streamRegistry._resetForTesting();

    ctx = createMockContext();
    disposable = createLifecycleSubscriber(ctx);

    mockKill = vi.fn().mockResolvedValue({});
    mockResume = vi.fn().mockReturnValue((async function* () { /* empty stream */ })());
    vi.spyOn(adapterManager, "getConnection").mockReturnValue({
      client: { kill: mockKill, resume: mockResume },
    } as unknown as ReturnType<typeof adapterManager.getConnection>);
  });

  afterEach(() => {
    disposable.dispose();
  });

  it("reanimates STOPPED session when external subscription created", () => {
    sessionStore.createSession("sess-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSession("sess-1", "stopped", undefined, undefined, "completed");
    // Set runtimeSessionId (required for reanimate)
    sqlite.exec("UPDATE sessions SET runtime_session_id = 'rt-1' WHERE id = 'sess-1'");

    // Create lifecycle stream (simulates ensureLifecycleStream from a prior spawn)
    const stream = streamRegistry.createStream("lifecycle:sess-1");
    // Session's own subscription — should NOT trigger reanimate
    streamRegistry.subscribe(stream.id, "sess-1", "rw", "detach", false);

    // External subscription — SHOULD trigger reanimate
    streamRegistry.subscribe(stream.id, "__server__", "rw", "detach", true);

    const session = sessionStore.getSession("sess-1");
    expect(session?.status).toBe("running");
  });

  it("does NOT reanimate active session", () => {
    sessionStore.createSession("sess-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSessionStatus("sess-1", "running");
    sqlite.exec("UPDATE sessions SET runtime_session_id = 'rt-1' WHERE id = 'sess-1'");

    const stream = streamRegistry.createStream("lifecycle:sess-1");
    streamRegistry.subscribe(stream.id, "sess-1", "rw", "detach", false);
    streamRegistry.subscribe(stream.id, "__server__", "rw", "detach", true);

    // Should stay running (not re-triggered)
    expect(sessionStore.getSession("sess-1")?.status).toBe("running");
    expect(mockResume).not.toHaveBeenCalled();
  });

  it("does NOT reanimate when session has no runtimeSessionId", () => {
    sessionStore.createSession("sess-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSession("sess-1", "stopped", undefined, undefined, "completed");
    // No runtimeSessionId set

    const stream = streamRegistry.createStream("lifecycle:sess-1");
    streamRegistry.subscribe(stream.id, "sess-1", "rw", "detach", false);
    streamRegistry.subscribe(stream.id, "__server__", "rw", "detach", true);

    expect(sessionStore.getSession("sess-1")?.status).toBe("stopped");
    expect(mockResume).not.toHaveBeenCalled();
  });

  it("does NOT reanimate when environment has another active session", () => {
    sessionStore.createSession("active-sess", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSessionStatus("active-sess", "running");

    sessionStore.createSession("stopped-sess", "test-env", "claude-code", "test", "sonnet", "/tmp/log2");
    sessionStore.updateSession("stopped-sess", "stopped", undefined, undefined, "completed");
    sqlite.exec("UPDATE sessions SET runtime_session_id = 'rt-2' WHERE id = 'stopped-sess'");

    const stream = streamRegistry.createStream("lifecycle:stopped-sess");
    streamRegistry.subscribe(stream.id, "stopped-sess", "rw", "detach", false);
    streamRegistry.subscribe(stream.id, "__server__", "rw", "detach", true);

    expect(sessionStore.getSession("stopped-sess")?.status).toBe("stopped");
    expect(mockResume).not.toHaveBeenCalled();
  });

  it("does NOT reanimate when environment is disconnected", () => {
    sessionStore.createSession("sess-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
    sessionStore.updateSession("sess-1", "stopped", undefined, undefined, "completed");
    sqlite.exec("UPDATE sessions SET runtime_session_id = 'rt-1' WHERE id = 'sess-1'");

    // Override mock to return undefined (disconnected)
    vi.spyOn(adapterManager, "getConnection").mockReturnValue(undefined as unknown as ReturnType<typeof adapterManager.getConnection>);

    const stream = streamRegistry.createStream("lifecycle:sess-1");
    streamRegistry.subscribe(stream.id, "sess-1", "rw", "detach", false);
    streamRegistry.subscribe(stream.id, "__server__", "rw", "detach", true);

    expect(sessionStore.getSession("sess-1")?.status).toBe("stopped");
  });

  it("reanimates regardless of endReason", () => {
    for (const reason of ["completed", "killed", "interrupted", "terminated"]) {
      sqlite.exec("DELETE FROM sessions");
      streamRegistry._resetForTesting();
      disposable.dispose();
      disposable = createLifecycleSubscriber(createMockContext());

      sessionStore.createSession(`sess-${reason}`, "test-env", "claude-code", "test", "sonnet", "/tmp/log");
      sessionStore.updateSession(`sess-${reason}`, "stopped", undefined, undefined, reason);
      sqlite.exec(`UPDATE sessions SET runtime_session_id = 'rt-${reason}' WHERE id = 'sess-${reason}'`);

      const stream = streamRegistry.createStream(`lifecycle:sess-${reason}`);
      streamRegistry.subscribe(stream.id, `sess-${reason}`, "rw", "detach", false);
      streamRegistry.subscribe(stream.id, "__server__", "rw", "detach", true);

      expect(sessionStore.getSession(`sess-${reason}`)?.status).toBe("running");
    }
  });
});
