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
  readLastTextEntry: vi.fn().mockReturnValue(undefined),
}));

// ── Imports (after mocks) ───────────────────────────────────
import { openDatabase, initDatabase, sqlite as _sqlite, sessionStore } from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
const sqlite = _sqlite!;
import * as streamRegistry from "./stream-registry.js";
import * as adapterManager from "./adapter-manager.js";
import * as pipeDelivery from "./pipe-delivery.js";
import { ensureStdinStream, publishToStdin, cleanupStdinStream } from "./stdin-delivery.js";

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
      cost_usd           REAL NOT NULL DEFAULT 0,
      end_reason         TEXT,
      sigterm_sent_at    TEXT
    );
  `);
  sqlite.exec("INSERT OR IGNORE INTO environments (id) VALUES ('test-env')");
}

describe("stdin-delivery", () => {
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

  // ─── ensureStdinStream ────────────────────────────────────

  describe("ensureStdinStream", () => {
    it("creates stdin stream with correct name", () => {
      ensureStdinStream("session-1");

      const stream = streamRegistry.getStreamByName("stdin:session-1");
      expect(stream).toBeDefined();
      expect(stream!.name).toBe("stdin:session-1");
    });

    it("is idempotent — second call is a no-op", () => {
      ensureStdinStream("session-1");
      ensureStdinStream("session-1");

      // Should still only have one stream
      const stream = streamRegistry.getStreamByName("stdin:session-1");
      expect(stream).toBeDefined();
      expect(stream!.subscriptions.size).toBe(2);
    });

    it("server gets write-only/detach subscription", () => {
      ensureStdinStream("session-1");

      const serverSubs = streamRegistry.getSubscriptionsForSession("__server__");
      const stdinSub = serverSubs.find((s) => {
        const stream = streamRegistry.getStream(s.streamId);
        return stream?.name === "stdin:session-1";
      });
      expect(stdinSub).toBeDefined();
      expect(stdinSub!.permission).toBe("w");
      expect(stdinSub!.deliveryMode).toBe("detach");
    });

    it("session gets read-only/async subscription", () => {
      ensureStdinStream("session-1");

      const sessionSubs = streamRegistry.getSubscriptionsForSession("session-1");
      const stdinSub = sessionSubs.find((s) => {
        const stream = streamRegistry.getStream(s.streamId);
        return stream?.name === "stdin:session-1";
      });
      expect(stdinSub).toBeDefined();
      expect(stdinSub!.permission).toBe("r");
      expect(stdinSub!.deliveryMode).toBe("async");
    });

    it("registers async delivery listener on session", () => {
      sessionStore.createSession("session-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
      ensureStdinStream("session-1");

      // Publish a message — if listener is registered, sendInput should be called
      const stream = streamRegistry.getStreamByName("stdin:session-1")!;
      streamRegistry.publish(stream.id, "__server__", "hello");

      expect(mockSendInput).toHaveBeenCalledOnce();
    });
  });

  // ─── publishToStdin ───────────────────────────────────────

  describe("publishToStdin", () => {
    it("publishes message with __server__ as sender", () => {
      ensureStdinStream("session-1");

      publishToStdin("session-1", "user message");

      const stream = streamRegistry.getStreamByName("stdin:session-1")!;
      // Server is the sender — session's async listener should fire
      // (publish skips sender's own subscriptions)
      expect(stream).toBeDefined();
    });

    it("idempotently creates stdin stream if it does not exist", () => {
      // Should NOT throw — publishToStdin calls ensureStdinStream internally
      publishToStdin("new-session", "hello");
      expect(streamRegistry.getStreamByName("stdin:new-session")).toBeDefined();
    });

    it("delivers message to session via async listener as plain text", () => {
      sessionStore.createSession("session-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
      ensureStdinStream("session-1");

      publishToStdin("session-1", "hello from user");

      expect(mockSendInput).toHaveBeenCalledOnce();
      const call = mockSendInput.mock.calls[0][0];
      expect(call.sessionId).toBe("session-1");
      // Should be plain text — NO [fd:N] prefix
      expect(call.text).toBe("hello from user");
      expect(call.text).not.toContain("[fd:");
    });
  });

  // ─── stdin vs pipe formatting ─────────────────────────────

  describe("stdin vs pipe message formatting", () => {
    it("stdin messages arrive as plain text", () => {
      sessionStore.createSession("session-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
      ensureStdinStream("session-1");

      publishToStdin("session-1", "user input");

      const call = mockSendInput.mock.calls[0][0];
      expect(call.text).toBe("user input");
    });

    it("pipe messages still arrive with [fd:N] prefix", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      const pipeStream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(pipeStream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(pipeStream.id, "child", "rw", "async", false);
      pipeDelivery.ensureAsyncDeliveryListener("child");

      // Parent writes to pipe
      streamRegistry.publish(pipeStream.id, "parent", "instruction from parent");

      expect(mockSendInput).toHaveBeenCalledOnce();
      const call = mockSendInput.mock.calls[0][0];
      expect(call.sessionId).toBe("child");
      expect(call.text).toContain("[fd:");
      expect(call.text).toContain("instruction from parent");
    });

    it("both stdin and pipe can coexist on the same session", () => {
      sessionStore.createSession("parent", "test-env", "claude-code", "p", "sonnet", "/tmp/p");
      sessionStore.createSession("child", "test-env", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

      // Create stdin for child
      ensureStdinStream("child");

      // Create pipe for child
      const pipeStream = streamRegistry.createStream("pipe:child");
      streamRegistry.subscribe(pipeStream.id, "parent", "rw", "async", true);
      streamRegistry.subscribe(pipeStream.id, "child", "rw", "async", false);
      // ensureAsyncDeliveryListener already called by ensureStdinStream

      // Send via stdin (plain text)
      publishToStdin("child", "stdin message");

      expect(mockSendInput).toHaveBeenCalledTimes(1);
      expect(mockSendInput.mock.calls[0][0].text).toBe("stdin message");

      mockSendInput.mockClear();

      // Send via pipe ([fd:N] prefix)
      streamRegistry.publish(pipeStream.id, "parent", "pipe message");

      expect(mockSendInput).toHaveBeenCalledTimes(1);
      expect(mockSendInput.mock.calls[0][0].text).toContain("[fd:");
      expect(mockSendInput.mock.calls[0][0].text).toContain("pipe message");
    });
  });

  // ─── Error handling ───────────────────────────────────────

  describe("error handling", () => {
    it("delivery fails when environment is disconnected", () => {
      sessionStore.createSession("session-1", "test-env", "claude-code", "test", "sonnet", "/tmp/log");
      ensureStdinStream("session-1");

      // Disconnect environment
      vi.spyOn(adapterManager, "getConnection").mockReturnValue(
        undefined as unknown as ReturnType<typeof adapterManager.getConnection>,
      );

      // Publish should not throw (stream-registry catches listener errors)
      // but message should be left undelivered
      const stream = streamRegistry.getStreamByName("stdin:session-1")!;
      streamRegistry.publish(stream.id, "__server__", "lost message");

      expect(mockSendInput).not.toHaveBeenCalled();
    });
  });

  // ─── cleanupStdinStream ─────────────────────────────────

  describe("cleanupStdinStream", () => {
    it("removes the stdin stream and all subscriptions", () => {
      ensureStdinStream("session-1");
      expect(streamRegistry.getStreamByName("stdin:session-1")).toBeDefined();

      cleanupStdinStream("session-1");

      expect(streamRegistry.getStreamByName("stdin:session-1")).toBeUndefined();
      const sessionSubs = streamRegistry.getSubscriptionsForSession("session-1")
        .filter((s) => streamRegistry.getStream(s.streamId)?.name.startsWith("stdin:"));
      expect(sessionSubs).toHaveLength(0);
    });

    it("is a no-op when stdin stream does not exist", () => {
      // Should not throw
      cleanupStdinStream("nonexistent");
    });
  });
});
