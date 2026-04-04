/**
 * Integration tests for reanimateAgent() pipe stream reconstruction.
 *
 * Uses real stream-registry, pipe-delivery, lifecycle-streams, and stdin-delivery
 * modules. Mocks only the external boundaries (adapter, log-writer, event-processor,
 * etc.) so we exercise the actual wiring through reanimateAgent().
 *
 * Parent and child sessions are placed on separate environments to satisfy the
 * "one active session per environment" constraint in reanimateAgent().
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks (must be before imports) ──────────────────────────

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./log-writer.js", () => ({
  initLog: vi.fn(),
  ensureLogInitialized: vi.fn(),
  writeEvent: vi.fn(),
  endSession: vi.fn(),
  readLog: vi.fn(() => []),
  readLastTextEntry: vi.fn().mockReturnValue(null),
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

// Mock processEventStream — no real PowerLine stream needed
vi.mock("./event-processor.js", () => ({
  processEventStream: vi.fn(),
}));

// ── Imports (after mocks) ───────────────────────────────────

import { openDatabase, initDatabase, sqlite as _sqlite, sessionStore } from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
const sqlite = _sqlite!;

import * as streamRegistry from "./stream-registry.js";
import * as pipeDelivery from "./pipe-delivery.js";
import * as adapterManager from "./adapter-manager.js";
import { reanimateAgent } from "./reanimate-agent.js";

// ── Schema ──────────────────────────────────────────────────

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
  // Two environments so parent and child can each have an independent active-session slot
  sqlite.exec("INSERT OR IGNORE INTO environments (id) VALUES ('env-parent')");
  sqlite.exec("INSERT OR IGNORE INTO environments (id) VALUES ('env-child')");
}

// ── Helpers ─────────────────────────────────────────────────

/** Suspend a session and give it a runtimeSessionId so reanimateAgent accepts it. */
function prepareSuspendedSession(id: string): void {
  sqlite.exec(`UPDATE sessions SET status = 'suspended', runtime_session_id = 'rt-${id}' WHERE id = '${id}'`);
}

// ── Tests ───────────────────────────────────────────────────

describe("reanimateAgent — pipe stream reconstruction", () => {
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
      client: {
        sendInput: mockSendInput,
        resume: vi.fn(() => (async function* () {})()),
      },
    } as unknown as ReturnType<typeof adapterManager.getConnection>);
  });

  it("reconstructs async pipe stream when child session is reanimated", () => {
    // Parent on env-parent (running), child on env-child (to be reanimated)
    sessionStore.createSession("parent", "env-parent", "claude-code", "p", "sonnet", "/tmp/p");
    sessionStore.createSession("child", "env-child", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");
    prepareSuspendedSession("child");

    reanimateAgent("child");

    // pipe:child stream should exist with both subscriptions
    const pipeStream = streamRegistry.getStreamByName("pipe:child");
    expect(pipeStream).toBeDefined();
    const subs = Array.from(pipeStream!.subscriptions.values());
    expect(subs.some((s) => s.sessionId === "parent")).toBe(true);
    expect(subs.some((s) => s.sessionId === "child")).toBe(true);
  });

  it("async delivery listener is active after reanimate — parent receives child publish", () => {
    sessionStore.createSession("parent", "env-parent", "claude-code", "p", "sonnet", "/tmp/p");
    sessionStore.createSession("child", "env-child", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");
    prepareSuspendedSession("child");

    reanimateAgent("child");

    // Publish from child — parent should receive via sendInput
    const pipeStream = streamRegistry.getStreamByName("pipe:child")!;
    streamRegistry.publish(pipeStream.id, "child", "Hello from child post-reanimate");

    expect(mockSendInput).toHaveBeenCalledOnce();
    const call = mockSendInput.mock.calls[0][0] as { sessionId: string; text: string };
    expect(call.sessionId).toBe("parent");
    expect(call.text).toContain("Hello from child post-reanimate");
  });

  it("reconstructs pipe streams for active async-piped children when parent is reanimated", () => {
    // Parent on env-parent (to be reanimated); child on env-child (idle — non-terminal)
    sessionStore.createSession("parent", "env-parent", "claude-code", "p", "sonnet", "/tmp/p");
    sessionStore.createSession("child", "env-child", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");
    sqlite.exec("UPDATE sessions SET status = 'idle' WHERE id = 'child'");
    prepareSuspendedSession("parent");

    reanimateAgent("parent");

    expect(streamRegistry.getStreamByName("pipe:child")).toBeDefined();
  });

  it("replays buffered undelivered messages during reanimate", async () => {
    sessionStore.createSession("parent", "env-parent", "claude-code", "p", "sonnet", "/tmp/p");
    sessionStore.createSession("child", "env-child", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");

    // Simulate: stream exists but message was published with no listener (env offline)
    const pipeStream = streamRegistry.createStream("pipe:child");
    const parentSub = streamRegistry.subscribe(pipeStream.id, "parent", "rw", "async", true);
    streamRegistry.subscribe(pipeStream.id, "child", "rw", "async", false);
    streamRegistry.publish(pipeStream.id, "child", "Message sent while offline");
    expect(streamRegistry.hasUndeliveredMessages(parentSub.id)).toBe(true);

    prepareSuspendedSession("child");
    reanimateAgent("child");

    // Replay delivers the buffered message via sendInput
    await vi.waitFor(() => {
      const calls = mockSendInput.mock.calls.map(
        (c: unknown[]) => c[0] as { sessionId: string; text: string },
      );
      const parentCall = calls.find((c) => c.sessionId === "parent");
      expect(parentCall).toBeDefined();
      expect(parentCall!.text).toContain("Message sent while offline");
    });
  });

  it("does not reconstruct pipe stream for stopped children", () => {
    sessionStore.createSession("parent", "env-parent", "claude-code", "p", "sonnet", "/tmp/p");
    sessionStore.createSession("child", "env-child", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "async");
    sqlite.exec("UPDATE sessions SET status = 'stopped' WHERE id = 'child'");
    prepareSuspendedSession("parent");

    reanimateAgent("parent");

    expect(streamRegistry.getStreamByName("pipe:child")).toBeUndefined();
  });

  it("does not reconstruct pipe stream for sync-piped child sessions", () => {
    sessionStore.createSession("parent", "env-parent", "claude-code", "p", "sonnet", "/tmp/p");
    sessionStore.createSession("child", "env-child", "claude-code", "c", "sonnet", "/tmp/c", "", "", "parent", "sync");
    prepareSuspendedSession("child");

    reanimateAgent("child");

    // Sync pipes are not reconstructable — no pipe:child stream
    expect(streamRegistry.getStreamByName("pipe:child")).toBeUndefined();
  });
});
