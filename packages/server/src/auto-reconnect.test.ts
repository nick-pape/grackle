/**
 * Tests for auto-reconnect of disconnected environments.
 * Covers: successful reconnect, backoff timing, max retries,
 * concurrent lock, clearReconnectState, session recovery trigger.
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

vi.mock("./session-recovery.js", () => ({
  recoverSuspendedSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./reanimate-agent.js", () => ({
  reanimateAgent: vi.fn(),
}));

// ── Imports (after mocks) ───────────────────────────────────

import { sqlite } from "./test-db.js";
import * as envRegistry from "./env-registry.js";
import * as adapterManager from "./adapter-manager.js";
import * as tokenBroker from "./token-broker.js";
import { recoverSuspendedSessions } from "./session-recovery.js";
import { emit } from "./event-bus.js";
import { attemptReconnects, clearReconnectState, _resetForTesting } from "./auto-reconnect.js";
import type { EnvironmentAdapter, PowerLineConnection } from "@grackle-ai/adapter-sdk";

// ── Schema ──────────────────────────────────────────────────

function applySchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      adapter_type TEXT NOT NULL DEFAULT 'local',
      adapter_config TEXT NOT NULL DEFAULT '{}',
      default_runtime TEXT NOT NULL DEFAULT 'claude-code',
      bootstrapped INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'disconnected',
      last_seen TEXT,
      env_info TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      powerline_token TEXT NOT NULL DEFAULT ''
    );
  `);
}

// ── Helpers ─────────────────────────────────────────────────

function insertEnv(id: string, status: string = "disconnected", bootstrapped: number = 1): void {
  sqlite.exec(`INSERT INTO environments (id, display_name, adapter_type, adapter_config, status, bootstrapped, powerline_token)
    VALUES ('${id}', 'Test', 'test', '{}', '${status}', ${bootstrapped}, 'tok-${id}')`);
}

function makeAdapter(connectResult?: PowerLineConnection): EnvironmentAdapter {
  const conn: PowerLineConnection = connectResult ?? {
    client: {} as PowerLineConnection["client"],
    environmentId: "env1",
    port: 7433,
  };
  return {
    type: "test",
    provision: async function* () {},
    connect: vi.fn().mockResolvedValue(conn),
    disconnect: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
    reconnect: async function* () {},
  } as unknown as EnvironmentAdapter;
}

// ── Tests ───────────────────────────────────────────────────

describe("auto-reconnect", () => {
  beforeEach(() => {
    sqlite.exec("DROP TABLE IF EXISTS environments");
    applySchema();
    vi.clearAllMocks();
    _resetForTesting();
    // Spy on tokenBroker
    vi.spyOn(tokenBroker, "pushToEnv").mockResolvedValue();
  });

  it("reconnects a disconnected environment after initial delay", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    // First call: initializes state with delay, doesn't attempt yet
    await attemptReconnects();
    expect(adapter.connect).not.toHaveBeenCalled();

    // Simulate time passing beyond initial delay
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15_000);

    // Second call: backoff elapsed, attempts reconnect
    await attemptReconnects();

    // Wait for fire-and-forget tryReconnect to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(adapter.connect).toHaveBeenCalledWith("env1", expect.any(Object), "tok-env1");
    const env = envRegistry.getEnvironment("env1");
    expect(env?.status).toBe("connected");
  });

  it("respects backoff timing — skips if too early", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    // Initialize state
    await attemptReconnects();

    // Call again immediately (no time passed)
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    // Should not have attempted
    expect(adapter.connect).not.toHaveBeenCalled();
  });

  it("stops after max retries and sets status to error", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    (adapter.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("unreachable"));
    adapterManager.registerAdapter(adapter);

    // Initialize + exhaust 5 retries
    for (let i = 0; i < 7; i++) {
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 200_000 * (i + 1));
      await attemptReconnects();
      await new Promise((r) => setTimeout(r, 50));
    }

    const env = envRegistry.getEnvironment("env1");
    expect(env?.status).toBe("error");
    // Should have been called exactly 5 times (max retries)
    expect(adapter.connect).toHaveBeenCalledTimes(5);
  });

  it("clears state on successful reconnect", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    // Initialize state
    await attemptReconnects();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15_000);

    // Reconnect succeeds
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    // State should be cleared — next disconnect would start fresh
    expect(envRegistry.getEnvironment("env1")?.status).toBe("connected");
  });

  it("triggers session recovery on successful reconnect", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    await attemptReconnects();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    expect(recoverSuspendedSessions).toHaveBeenCalled();
  });

  it("clearReconnectState prevents further retries", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    // Initialize state
    await attemptReconnects();

    // Clear state (as if user manually provisioned)
    clearReconnectState("env1");

    // Even with time passed, clearing resets everything — next call re-initializes
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    // Re-initialized state means another initial delay, so no connect yet
    expect(adapter.connect).not.toHaveBeenCalled();
  });

  it("skips environments that are not disconnected", async () => {
    insertEnv("env1", "connected");
    insertEnv("env2", "connecting");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    await attemptReconnects();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    expect(adapter.connect).not.toHaveBeenCalled();
  });

  it("pushes tokens with excludeFileTokens for local adapter", async () => {
    sqlite.exec(`INSERT INTO environments (id, display_name, adapter_type, adapter_config, status, bootstrapped, powerline_token)
      VALUES ('local-env', 'Local', 'local', '{}', 'disconnected', 1, 'tok-local')`);
    const adapter = makeAdapter();
    (adapter as unknown as { type: string }).type = "local";
    adapterManager.registerAdapter(adapter);

    await attemptReconnects();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    expect(tokenBroker.pushToEnv).toHaveBeenCalledWith("local-env", { excludeFileTokens: true });
  });

  it("concurrent lock prevents overlapping reconnect attempts", async () => {
    insertEnv("env1");
    // Make connect slow so we can test overlap
    const adapter = makeAdapter();
    let connectCount = 0;
    (adapter.connect as ReturnType<typeof vi.fn>).mockImplementation(() => {
      connectCount++;
      return new Promise((resolve) => setTimeout(() => resolve({
        client: {} as PowerLineConnection["client"],
        environmentId: "env1",
        port: 7433,
      }), 100));
    });
    adapterManager.registerAdapter(adapter);

    // Initialize state
    await attemptReconnects();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15_000);

    // Fire two reconnect attempts concurrently
    const p1 = attemptReconnects();
    const p2 = attemptReconnects();
    await Promise.all([p1, p2]);
    await new Promise((r) => setTimeout(r, 150));

    // Only one connect should have been made
    expect(connectCount).toBe(1);
  });
});
