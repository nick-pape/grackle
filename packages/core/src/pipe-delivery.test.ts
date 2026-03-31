import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks (must be before imports) ──────────────────────────
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
import { openDatabase, initDatabase, sqlite as _sqlite, sessionStore } from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
const sqlite = _sqlite!;
import * as streamRegistry from "./stream-registry.js";
import * as adapterManager from "./adapter-manager.js";
import * as pipeDelivery from "./pipe-delivery.js";

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
      cost_millicents    INTEGER NOT NULL DEFAULT 0,
      end_reason         TEXT,
      sigterm_sent_at    TEXT
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

      await pipeDelivery.publishChildCompletion("child", "completed");

      // Stream should be cleaned up after successful delivery
      expect(streamRegistry.getStreamByName("pipe:child")).toBeUndefined();
    });

    it("keeps stream when delivery fails (listener throws)", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      // Mock: parent env not connected → listener throws
      vi.spyOn(adapterManager, "getConnection").mockReturnValue(undefined as unknown as ReturnType<typeof adapterManager.getConnection>);
      pipeDelivery.setupAsyncPipeDelivery("parent");

      await pipeDelivery.publishChildCompletion("child", "completed");

      // Stream should still exist (undelivered message retained)
      expect(streamRegistry.getStreamByName("pipe:child")).toBeDefined();
    });
  });

  // ─── Bidirectional Delivery (parent→child via unified path) ─

  describe("parent→child delivery via ensureAsyncDeliveryListener", () => {
    it("delivers parent write to child via async listener", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      // Register listeners for BOTH directions (mimics new spawnAgent behavior)
      pipeDelivery.ensureAsyncDeliveryListener("parent");
      pipeDelivery.ensureAsyncDeliveryListener("child");

      // Parent publishes to stream (mimics writeToFd calling streamRegistry.publish)
      streamRegistry.publish(stream.id, "parent", "Hello from parent");

      // Child should receive via sendInput (listener for child session fires)
      expect(mockSendInput).toHaveBeenCalledOnce();
      const call = mockSendInput.mock.calls[0][0];
      expect(call.sessionId).toBe("child");
      expect(call.text).toContain("Hello from parent");
    });

    it("delivers child publish to parent via async listener", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      pipeDelivery.ensureAsyncDeliveryListener("parent");
      pipeDelivery.ensureAsyncDeliveryListener("child");

      // Child publishes to stream
      streamRegistry.publish(stream.id, "child", "Result from child");

      // Parent should receive
      expect(mockSendInput).toHaveBeenCalledOnce();
      const call = mockSendInput.mock.calls[0][0];
      expect(call.sessionId).toBe("parent");
      expect(call.text).toContain("Result from child");
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

  // ─── Sync Pipe: waiting_input (idle) delivery (#824) ───────

  describe("sync pipe: waiting_input triggers delivery", () => {
    it("unblocks consumeSync with idle completion message", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      const stream = streamRegistry.createStream("pipe:child");
      const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      // Start blocking consume
      const consumePromise = streamRegistry.consumeSync(parentSub.id);

      // Trigger child idle (should publish to stream, unblocking consumeSync)
      pipeDelivery.publishChildCompletion("child", "waiting_input");

      const msg = await consumePromise;
      expect(msg.content).toContain("finished (idle)");
      expect(msg.content).toContain("Child's final output");
    });

    it("does NOT clean up stream (waitForPipe handles that)", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      pipeDelivery.publishChildCompletion("child", "waiting_input");

      // Stream should still exist (sync cleanup is consumer's responsibility)
      expect(streamRegistry.getStreamByName("pipe:child")).toBeDefined();
    });
  });

  describe("async pipe: waiting_input is a no-op", () => {
    it("does not deliver or clean up on waiting_input", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
      pipeDelivery.setupAsyncPipeDelivery("parent");

      pipeDelivery.publishChildCompletion("child", "waiting_input");

      // Async pipe should ignore waiting_input — child can still accept input
      expect(mockSendInput).not.toHaveBeenCalled();
      expect(streamRegistry.getStreamByName("pipe:child")).toBeDefined();
    });
  });

  // ─── Sync Pipe Lifecycle Cleanup (#824 Part B) ────────────

  describe("cleanupSyncPipeAndLifecycle", () => {
    it("deletes both pipe and lifecycle streams", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      // Create both streams (mimics spawnAgent)
      const lifecycleStream = streamRegistry.createStream("lifecycle:child");
      streamRegistry.subscribe(lifecycleStream.id, "parent", "rw", "detach", true);
      streamRegistry.subscribe(lifecycleStream.id, "child", "rw", "detach", false);

      const pipeStream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(pipeStream.id, "parent", "rw", "sync", true);
      streamRegistry.subscribe(pipeStream.id, "child", "rw", "async", false);

      pipeDelivery.cleanupSyncPipeAndLifecycle(pipeStream.id);

      expect(streamRegistry.getStreamByName("pipe:child")).toBeUndefined();
      expect(streamRegistry.getStreamByName("lifecycle:child")).toBeUndefined();
    });

    it("handles missing lifecycle stream gracefully", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      // Only pipe stream, no lifecycle stream
      const pipeStream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(pipeStream.id, "parent", "rw", "sync", true);
      streamRegistry.subscribe(pipeStream.id, "child", "rw", "async", false);

      // Should not throw
      pipeDelivery.cleanupSyncPipeAndLifecycle(pipeStream.id);

      expect(streamRegistry.getStreamByName("pipe:child")).toBeUndefined();
    });

    it("is a no-op for nonexistent stream", () => {
      // Should not throw
      pipeDelivery.cleanupSyncPipeAndLifecycle("nonexistent-id");
    });

    it("cleans up lifecycle stream even when pipe stream is already gone", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      // Create both streams
      const lifecycleStream = streamRegistry.createStream("lifecycle:child");
      streamRegistry.subscribe(lifecycleStream.id, "parent", "rw", "detach", true);
      streamRegistry.subscribe(lifecycleStream.id, "child", "rw", "detach", false);

      const pipeStream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(pipeStream.id, "parent", "rw", "sync", true);
      streamRegistry.subscribe(pipeStream.id, "child", "rw", "async", false);

      // Simulate pipe stream being removed by a concurrent fd close
      streamRegistry.deleteStream(pipeStream.id);
      expect(streamRegistry.getStream(pipeStream.id)).toBeUndefined();

      // With explicit childSessionId, lifecycle cleanup still runs
      pipeDelivery.cleanupSyncPipeAndLifecycle(pipeStream.id, "child");

      expect(streamRegistry.getStreamByName("lifecycle:child")).toBeUndefined();
    });
  });

  // ─── No-ops ────────────────────────────────────────────────

  describe("no-op cases", () => {
    it("does nothing for detach pipe even with stream set up", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "detach");

      // Set up stream + listener (to prove publishChildCompletion doesn't use them)
      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
      pipeDelivery.setupAsyncPipeDelivery("parent");

      pipeDelivery.publishChildCompletion("child", "completed");

      expect(mockSendInput).not.toHaveBeenCalled();
      // Stream should be untouched (no messages buffered)
      expect(stream.messages).toHaveLength(0);
    });

    it("does nothing for session without parent even with stream set up", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c");

      // Set up stream + listener
      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
      pipeDelivery.setupAsyncPipeDelivery("parent");

      pipeDelivery.publishChildCompletion("child", "completed");

      expect(mockSendInput).not.toHaveBeenCalled();
      expect(stream.messages).toHaveLength(0);
    });

    it("does nothing for nonexistent session", () => {
      pipeDelivery.publishChildCompletion("nonexistent", "completed");

      expect(mockSendInput).not.toHaveBeenCalled();
    });
  });

  // ─── End-to-end delivery tracking (post-dispatch gRPC failures) ──

  describe("async pipe: post-dispatch gRPC failure tracking", () => {
    it("leaves message undelivered and keeps stream when sendInput rejects", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      // Mock sendInput to reject — simulates network/gRPC failure after dispatch
      mockSendInput.mockRejectedValue(new Error("gRPC network failure"));
      pipeDelivery.ensureAsyncDeliveryListener("parent");

      await pipeDelivery.publishChildCompletion("child", "completed");

      // Message should still be undelivered (gRPC failed)
      expect(streamRegistry.hasUndeliveredMessages(parentSub.id)).toBe(true);

      // Stream should NOT be cleaned up — undelivered message must be retained
      expect(streamRegistry.getStreamByName("pipe:child")).toBeDefined();
    });

    it("marks message delivered and cleans up stream when sendInput resolves", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      // Mock sendInput to resolve — normal successful delivery
      mockSendInput.mockResolvedValue({});
      pipeDelivery.ensureAsyncDeliveryListener("parent");

      await pipeDelivery.publishChildCompletion("child", "completed");

      // Message should be marked delivered
      expect(streamRegistry.hasUndeliveredMessages(parentSub.id)).toBe(false);

      // Stream should be cleaned up after successful delivery
      expect(streamRegistry.getStreamByName("pipe:child")).toBeUndefined();
    });
  });

  // ─── Idempotency ───────────────────────────────────────────

  describe("setupAsyncPipeDelivery idempotency", () => {
    it("only calls registerAsyncListener once when invoked twice", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      const spy = vi.spyOn(streamRegistry, "registerAsyncListener");

      // Call twice
      pipeDelivery.setupAsyncPipeDelivery("parent");
      pipeDelivery.setupAsyncPipeDelivery("parent");

      // registerAsyncListener should only be called once (second call is idempotent no-op)
      expect(spy).toHaveBeenCalledOnce();

      await pipeDelivery.publishChildCompletion("child", "completed");

      // Should only deliver once
      expect(mockSendInput).toHaveBeenCalledOnce();
      spy.mockRestore();
    });
  });
});
