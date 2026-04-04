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
    it("calls sendInput on parent with rich message content", async () => {
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
      await pipeDelivery.publishChildCompletion("child", "completed");

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

  // ─── selfEcho streams: sender must not receive sendInput (#1184) ────────────

  describe("selfEcho stream: self-echo does not trigger sendInput for sender", () => {
    it("delivers to non-sender but NOT to sender on selfEcho stream (#1184)", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      // selfEcho=true: chatroom mode where the sender would see its own messages
      const stream = streamRegistry.createStream("chat:room", true);
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      pipeDelivery.ensureAsyncDeliveryListener("parent");
      pipeDelivery.ensureAsyncDeliveryListener("child");

      // Child publishes to selfEcho stream
      streamRegistry.publish(stream.id, "child", "Hello from child");

      // sendInput should be called exactly once — for parent, not child
      expect(mockSendInput).toHaveBeenCalledOnce();
      const call = mockSendInput.mock.calls[0][0];
      expect(call.sessionId).toBe("parent");
      expect(call.text).toContain("Hello from child");
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
      await pipeDelivery.publishChildCompletion("child", "completed");

      const msg = await consumePromise;
      expect(msg.content).toContain("completed");
      expect(msg.content).toContain("Child's final output");
    });

    it("does NOT clean up stream (waitForPipe handles that)", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      await pipeDelivery.publishChildCompletion("child", "completed");

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
      await pipeDelivery.publishChildCompletion("child", "waiting_input");

      const msg = await consumePromise;
      expect(msg.content).toContain("finished (idle)");
      expect(msg.content).toContain("Child's final output");
    });

    it("does NOT clean up stream (waitForPipe handles that)", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      await pipeDelivery.publishChildCompletion("child", "waiting_input");

      // Stream should still exist (sync cleanup is consumer's responsibility)
      expect(streamRegistry.getStreamByName("pipe:child")).toBeDefined();
    });
  });

  describe("async pipe: waiting_input is a no-op", () => {
    it("does not deliver or clean up on waiting_input", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
      pipeDelivery.setupAsyncPipeDelivery("parent");

      await pipeDelivery.publishChildCompletion("child", "waiting_input");

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
    it("does nothing for detach pipe even with stream set up", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "detach");

      // Set up stream + listener (to prove publishChildCompletion doesn't use them)
      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
      pipeDelivery.setupAsyncPipeDelivery("parent");

      await pipeDelivery.publishChildCompletion("child", "completed");

      expect(mockSendInput).not.toHaveBeenCalled();
      // Stream should be untouched (no messages buffered)
      expect(stream.messages).toHaveLength(0);
    });

    it("does nothing for session without parent even with stream set up", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c");

      // Set up stream + listener
      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
      pipeDelivery.setupAsyncPipeDelivery("parent");

      await pipeDelivery.publishChildCompletion("child", "completed");

      expect(mockSendInput).not.toHaveBeenCalled();
      expect(stream.messages).toHaveLength(0);
    });

    it("does nothing for nonexistent session", async () => {
      await pipeDelivery.publishChildCompletion("nonexistent", "completed");

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

  // ─── ensurePipeStream (reanimate pipe recovery) ────────────

  describe("ensurePipeStream", () => {
    it("creates stream and subscriptions when none exist", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      pipeDelivery.ensurePipeStream("child", "parent");

      const stream = streamRegistry.getStreamByName("pipe:child");
      expect(stream).toBeDefined();
      const subs = Array.from(stream!.subscriptions.values());
      expect(subs.some((s) => s.sessionId === "parent" && s.deliveryMode === "async")).toBe(true);
      expect(subs.some((s) => s.sessionId === "child" && s.deliveryMode === "async")).toBe(true);
    });

    it("is idempotent when stream already exists — does not create duplicate streams", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      // Pre-create the stream (simulates server staying up during suspend)
      const existing = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(existing.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(existing.id, "child", "rw", "async", false);

      pipeDelivery.ensurePipeStream("child", "parent");

      // Should still be exactly one stream with that name
      const stream = streamRegistry.getStreamByName("pipe:child");
      expect(stream).toBeDefined();
      expect(stream!.id).toBe(existing.id);
      expect(stream!.subscriptions.size).toBe(2);
    });

    it("registers async delivery listeners for both parent and child", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const spy = vi.spyOn(streamRegistry, "registerAsyncListener");

      pipeDelivery.ensurePipeStream("child", "parent");

      // Both parent and child listeners should be registered
      expect(spy).toHaveBeenCalledWith("parent", expect.any(Function));
      expect(spy).toHaveBeenCalledWith("child", expect.any(Function));
      spy.mockRestore();
    });

    it("replays buffered undelivered messages after listener re-registration", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      // Simulate: stream exists, message was published while env was offline (no listener → undelivered)
      const stream = streamRegistry.createStream("pipe:child");
      const parentSub = streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
      // Publish without any listener registered → message stays undelivered
      streamRegistry.publish(stream.id, "child", "Buffered message from offline window");
      expect(streamRegistry.hasUndeliveredMessages(parentSub.id)).toBe(true);

      // Now reanimate: ensurePipeStream re-registers listeners and replays
      pipeDelivery.ensurePipeStream("child", "parent");

      // Wait deterministically for the async replay delivery to settle
      await vi.waitFor(() => {
        const calls = mockSendInput.mock.calls.map((c: unknown[]) => c[0] as { sessionId: string; text: string });
        const parentCall = calls.find((c) => c.sessionId === "parent");
        expect(parentCall).toBeDefined();
        expect(parentCall!.text).toContain("Buffered message from offline window");
      });
    });

    it("calling ensurePipeStream twice while first replay is still in-flight does not duplicate delivery", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      // Publish a message with no listener → stays undelivered
      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
      streamRegistry.publish(stream.id, "child", "Offline message");

      // sendInput returns a never-resolving promise to keep delivery in-flight
      mockSendInput.mockReturnValue(new Promise(() => {}));

      // First ensurePipeStream call — triggers replay, listener fires once
      pipeDelivery.ensurePipeStream("child", "parent");
      expect(mockSendInput).toHaveBeenCalledTimes(1);

      // Second ensurePipeStream call while first is still in-flight — must NOT re-dispatch
      pipeDelivery.ensurePipeStream("child", "parent");
      expect(mockSendInput).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Promoted sync pipe cleanup ───────────────────────────

  describe("promoted sync pipe: publishChildCompletion cleanup", () => {
    it("cleans up promoted sync pipe after delivery (stream uses async subs)", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      // Simulate post-reanimate state: DB says "sync" but stream has async subscriptions
      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);
      pipeDelivery.ensureAsyncDeliveryListener("parent");

      await pipeDelivery.publishChildCompletion("child", "completed");

      // Promoted sync pipe should be cleaned up like an async pipe
      expect(streamRegistry.getStreamByName("pipe:child")).toBeUndefined();
    });

    it("does NOT clean up non-promoted sync pipe (sync parent subscription)", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      // Original (non-promoted) sync pipe: parent sub uses sync delivery mode
      const stream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(stream.id, "parent", "rw", "sync", true);
      streamRegistry.subscribe(stream.id, "child", "rw", "async", false);

      await pipeDelivery.publishChildCompletion("child", "completed");

      // Non-promoted sync pipe must NOT be cleaned up — waitForPipe handles that
      expect(streamRegistry.getStreamByName("pipe:child")).toBeDefined();
    });

    it("cleans up lifecycle stream on terminal status for promoted sync pipe", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      // Create lifecycle stream (would normally be cleaned by waitForPipe)
      const lifecycleStream = streamRegistry.createStream("lifecycle:child");
      streamRegistry.subscribe(lifecycleStream.id, "parent", "rw", "detach", true);
      streamRegistry.subscribe(lifecycleStream.id, "child", "rw", "detach", false);

      // Promoted pipe stream (async subs)
      const pipeStream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(pipeStream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(pipeStream.id, "child", "rw", "async", false);
      pipeDelivery.ensureAsyncDeliveryListener("parent");

      await pipeDelivery.publishChildCompletion("child", "completed");

      // Lifecycle stream should be cleaned up for terminal status
      expect(streamRegistry.getStreamByName("lifecycle:child")).toBeUndefined();
    });

    it("cleans up lifecycle stream on waiting_input for promoted sync pipe", async () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");

      // Create lifecycle stream (would normally be cleaned by waitForPipe)
      const lifecycleStream = streamRegistry.createStream("lifecycle:child");
      streamRegistry.subscribe(lifecycleStream.id, "parent", "rw", "detach", true);
      streamRegistry.subscribe(lifecycleStream.id, "child", "rw", "detach", false);

      // Promoted pipe stream (async subs)
      const pipeStream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(pipeStream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(pipeStream.id, "child", "rw", "async", false);
      pipeDelivery.ensureAsyncDeliveryListener("parent");

      await pipeDelivery.publishChildCompletion("child", "waiting_input");

      // Lifecycle stream should be cleaned up for waiting_input in promoted sync mode
      expect(streamRegistry.getStreamByName("lifecycle:child")).toBeUndefined();
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
