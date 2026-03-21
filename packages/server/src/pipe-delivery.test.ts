import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks (must be before imports) ──────────────────────────
vi.mock("./db.js", async () => {
  return await import("./test-db.js");
});

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./log-writer.js", () => ({
  initLog: vi.fn(),
  writeEvent: vi.fn(),
  endSession: vi.fn(),
  readLog: vi.fn().mockReturnValue([]),
  readLastTextEntry: vi.fn().mockReturnValue({ content: "Child's final output" }),
}));

// ── Imports (after mocks) ───────────────────────────────────
import * as sessionStore from "./session-store.js";
import * as streamRegistry from "./stream-registry.js";
import * as adapterManager from "./adapter-manager.js";
import * as pipeDelivery from "./pipe-delivery.js";
import { sqlite } from "./test-db.js";

/** Apply minimal schema for sessions + environments. */
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
      cost_usd           REAL NOT NULL DEFAULT 0
    );
  `);
  sqlite.exec("INSERT OR IGNORE INTO environments (id) VALUES ('test-env')");
}

describe("pipe-delivery integration", () => {
  /** Mock PowerLine connection for capturing sendInput calls. */
  let mockSendInput: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS sessions");
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
    vi.clearAllMocks();
    streamRegistry._resetForTesting();
    pipeDelivery._resetForTesting();

    mockSendInput = vi.fn().mockResolvedValue({});
    vi.spyOn(adapterManager, "getConnection").mockReturnValue({
      client: { sendInput: mockSendInput },
    } as unknown as ReturnType<typeof adapterManager.getConnection>);
  });

  // ─── Async Pipe ────────────────────────────────────────────

  describe("async pipe: child completion delivers to parent", () => {
    it("calls sendInput on parent with rich message content", () => {
      // Create parent + child sessions
      sessionStore.createSession("parent", "test-env", "claude-code", "parent prompt", "sonnet", "/tmp/parent");
      sessionStore.createSession("child", "test-env", "claude-code", "child prompt", "sonnet", "/tmp/child", "", "", "parent", "async");

      // Set up pipe stream (mimics spawnAgent)
      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      // Register async listener
      pipeDelivery.setupAsyncPipeDelivery("parent");

      // Trigger child completion
      pipeDelivery.publishChildCompletion("child", "completed");

      // Verify sendInput called on parent with message containing status + child output
      expect(mockSendInput).toHaveBeenCalledOnce();
      const call = mockSendInput.mock.calls[0][0];
      expect(call.sessionId).toBe("parent");
      expect(call.text).toContain("completed");
      expect(call.text).toContain("Child's final output");
    });
  });

  describe("async pipe: stream cleanup", () => {
    it("deletes stream after successful delivery", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
      pipeDelivery.setupAsyncPipeDelivery("parent");

      pipeDelivery.publishChildCompletion("child", "completed");

      // Stream should be cleaned up after successful delivery
      expect(streamRegistry.getStreamByName("pipe:child")).toBeUndefined();
    });

    it("keeps stream when delivery fails (listener throws)", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      // Mock: parent env not connected → listener throws
      vi.spyOn(adapterManager, "getConnection").mockReturnValue(undefined as unknown as ReturnType<typeof adapterManager.getConnection>);
      pipeDelivery.setupAsyncPipeDelivery("parent");

      pipeDelivery.publishChildCompletion("child", "completed");

      // Stream should still exist (undelivered message retained)
      expect(streamRegistry.getStreamByName("pipe:child")).toBeDefined();
    });
  });

  // ─── Sync Pipe ─────────────────────────────────────────────

  describe("sync pipe: child completion unblocks consumeSync", () => {
    it("resolves consumeSync with completion message", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      const stream = streamRegistry.createStream("pipe:child");
      const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      // Start blocking consume
      const consumePromise = streamRegistry.consumeSync(parentSub.id);

      // Trigger child completion (publishes to stream, unblocking consumeSync)
      pipeDelivery.publishChildCompletion("child", "completed");

      const msg = await consumePromise;
      expect(msg.content).toContain("completed");
      expect(msg.content).toContain("Child's final output");
    });

    it("does NOT clean up stream (waitForPipe handles that)", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      pipeDelivery.publishChildCompletion("child", "completed");

      // Stream should still exist (sync cleanup is consumer's responsibility)
      expect(streamRegistry.getStreamByName("pipe:child")).toBeDefined();
    });
  });

  // ─── No-ops ────────────────────────────────────────────────

  describe("no-op cases", () => {
    it("does nothing for detach pipe", () => {
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "detach");

      pipeDelivery.publishChildCompletion("child", "completed");

      expect(mockSendInput).not.toHaveBeenCalled();
    });

    it("does nothing for session without parent", () => {
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c");

      pipeDelivery.publishChildCompletion("child", "completed");

      expect(mockSendInput).not.toHaveBeenCalled();
    });

    it("does nothing for nonexistent session", () => {
      pipeDelivery.publishChildCompletion("nonexistent", "completed");

      expect(mockSendInput).not.toHaveBeenCalled();
    });
  });

  // ─── Idempotency ───────────────────────────────────────────

  describe("setupAsyncPipeDelivery idempotency", () => {
    it("only registers one listener when called twice", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      // Call twice
      pipeDelivery.setupAsyncPipeDelivery("parent");
      pipeDelivery.setupAsyncPipeDelivery("parent");

      pipeDelivery.publishChildCompletion("child", "completed");

      // Should only deliver once (not twice)
      expect(mockSendInput).toHaveBeenCalledOnce();
    });
  });
});
