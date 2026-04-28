/**
 * Tests for auto-reconnect of disconnected environments.
 * Covers: successful reconnect, backoff timing, max retries,
 * concurrent lock, clearReconnectState, session recovery trigger.
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

vi.mock("./session-recovery.js", () => ({
  recoverSuspendedSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./reanimate-agent.js", () => ({
  reanimateAgent: vi.fn(),
}));

// ── Imports (after mocks) ───────────────────────────────────

import { openDatabase, initDatabase, sqlite as _sqlite, envRegistry } from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
const sqlite = _sqlite!;
import * as adapterManager from "./adapter-manager.js";
import * as tokenPush from "./token-push.js";
import { recoverSuspendedSessions } from "./session-recovery.js";
import { emit } from "./event-bus.js";
import { attemptReconnects, clearReconnectState, resetReconnectState, isReconnecting, _resetForTesting } from "./auto-reconnect.js";
import type { EnvironmentAdapter, PowerLineConnection } from "@grackle-ai/adapter-sdk";
import { FatalAdapterError } from "@grackle-ai/adapter-sdk";

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
      powerline_token TEXT NOT NULL DEFAULT '',
      max_concurrent_sessions INTEGER NOT NULL DEFAULT 0,
      github_account_id TEXT NOT NULL DEFAULT ''
    );
  `);
}

// ── Helpers ─────────────────────────────────────────────────

function insertEnv(id: string, status: string = "disconnected", bootstrapped: number = 1, adapterType: string = "test"): void {
  sqlite.exec(`INSERT INTO environments (id, display_name, adapter_type, adapter_config, status, bootstrapped, powerline_token)
    VALUES ('${id}', 'Test', '${adapterType}', '{}', '${status}', ${bootstrapped}, 'tok-${id}')`);
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
    // Spy on tokenPush
    vi.spyOn(tokenPush, "pushToEnv").mockResolvedValue();
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

  it("transitions to sleeping after max retries (not error)", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    (adapter.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("unreachable"));
    adapterManager.registerAdapter(adapter);

    // Initialize + exhaust 5 retries (tick 0 initializes, ticks 1-5 attempt)
    for (let i = 0; i < 6; i++) {
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 200_000 * (i + 1));
      await attemptReconnects();
      await new Promise((r) => setTimeout(r, 50));
    }

    const env = envRegistry.getEnvironment("env1");
    expect(env?.status).toBe("sleeping");
    // 5 reconnect attempts during the disconnected phase
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

    expect(tokenPush.pushToEnv).toHaveBeenCalledWith("local-env", { excludeFileTokens: true });
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

  it("resetReconnectState makes environment immediately eligible", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    // Initialize state (creates entry with initial delay)
    await attemptReconnects();
    expect(adapter.connect).not.toHaveBeenCalled();

    // Reset state to immediately eligible (nextRetryAt = now)
    resetReconnectState("env1");

    // Next call should attempt reconnect immediately (no delay)
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    expect(adapter.connect).toHaveBeenCalledWith("env1", expect.any(Object), "tok-env1");
    expect(envRegistry.getEnvironment("env1")?.status).toBe("connected");
  });

  // ── Sleeping / probe behavior ─────────────────────────────

  it("probes sleeping environment after PROBE_INTERVAL_MS", async () => {
    insertEnv("env1", "sleeping");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    // First tick: sleeping env has no in-memory state, initializes lastProbeAt
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));
    expect(adapter.connect).not.toHaveBeenCalled();

    // Advance past probe interval (60s)
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    // Should have probed
    expect(adapter.connect).toHaveBeenCalledWith("env1", expect.any(Object), "tok-env1");
    expect(envRegistry.getEnvironment("env1")?.status).toBe("connected");
  });

  it("does not probe sleeping codespace environment", async () => {
    insertEnv("cs1", "sleeping", 1, "codespace");
    const adapter = makeAdapter();
    (adapter as unknown as { type: string }).type = "codespace";
    adapterManager.registerAdapter(adapter);

    // Advance well past probe interval
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    // Should NOT have probed — codespace is excluded
    expect(adapter.connect).not.toHaveBeenCalled();
    expect(envRegistry.getEnvironment("cs1")?.status).toBe("sleeping");
  });

  it("successful probe recovers sessions and clears state", async () => {
    insertEnv("env1", "sleeping");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    // Initialize probe state
    await attemptReconnects();

    // Advance past probe interval
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    expect(envRegistry.getEnvironment("env1")?.status).toBe("connected");
    expect(recoverSuspendedSessions).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("environment.changed", {});
  });

  it("failed probe stays sleeping without incrementing attempts", async () => {
    insertEnv("env1", "sleeping");
    const adapter = makeAdapter();
    (adapter.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("still down"));
    adapterManager.registerAdapter(adapter);

    // Initialize probe state
    await attemptReconnects();

    // Advance past probe interval and probe
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    // Should stay sleeping
    expect(envRegistry.getEnvironment("env1")?.status).toBe("sleeping");
    // Should NOT have triggered session recovery
    expect(recoverSuspendedSessions).not.toHaveBeenCalled();
  });

  it("probe respects concurrency lock", async () => {
    insertEnv("env1", "sleeping");
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

    // Initialize probe state
    await attemptReconnects();

    // Advance past probe interval
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65_000);

    // Fire two probe attempts concurrently
    const p1 = attemptReconnects();
    const p2 = attemptReconnects();
    await Promise.all([p1, p2]);
    await new Promise((r) => setTimeout(r, 150));

    expect(connectCount).toBe(1);
  });

  it("clearReconnectState from sleeping prevents probing", async () => {
    insertEnv("env1", "sleeping");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    // Initialize probe state
    await attemptReconnects();

    // Clear state (as if user manually provisioned)
    clearReconnectState("env1");

    // Advance past probe interval
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    // Should re-initialize (first tick for sleeping), not probe yet
    expect(adapter.connect).not.toHaveBeenCalled();
  });

  it("sleeping env with no in-memory state gets probed on second tick", async () => {
    // Simulates server restart: DB says sleeping but no in-memory state
    insertEnv("env1", "sleeping");
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    // First tick: creates state entry with lastProbeAt = now
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));
    expect(adapter.connect).not.toHaveBeenCalled();

    // Second tick after probe interval: should probe
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));
    expect(adapter.connect).toHaveBeenCalled();
  });

  it("preserves sleeping state during cleanup sweep", async () => {
    insertEnv("env1", "sleeping");
    insertEnv("env2", "connected"); // should be cleaned up
    const adapter = makeAdapter();
    adapterManager.registerAdapter(adapter);

    // Initialize sleeping state for env1
    await attemptReconnects();

    // Run again — env1 should NOT have its state deleted by the cleanup loop
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    // Advance past probe interval — env1 should still be probeable
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    expect(adapter.connect).toHaveBeenCalled();
  });

  // ── Existing reset tests ─────────────────────────────────

  it("resetReconnectState resets attempt count for fresh retries", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    (adapter.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("unreachable"));
    adapterManager.registerAdapter(adapter);

    // Exhaust some retries
    for (let i = 0; i < 4; i++) {
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 200_000 * (i + 1));
      await attemptReconnects();
      await new Promise((r) => setTimeout(r, 50));
    }

    // 3 attempts used (first call initializes, then 3 actual attempts)
    expect(adapter.connect).toHaveBeenCalledTimes(3);

    // Reset state — should get fresh retries
    resetReconnectState("env1");
    (adapter.connect as ReturnType<typeof vi.fn>).mockClear();

    // Make connect succeed now
    const conn: PowerLineConnection = {
      client: {} as PowerLineConnection["client"],
      environmentId: "env1",
      port: 7433,
    };
    (adapter.connect as ReturnType<typeof vi.fn>).mockResolvedValue(conn);

    // Next attempt should succeed (fresh state, no delay)
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    expect(adapter.connect).toHaveBeenCalledTimes(1);
    expect(envRegistry.getEnvironment("env1")?.status).toBe("connected");
  });

  // ── FatalAdapterError short-circuit ─────────────────────

  it("marks environment as error (not sleeping) and stops retrying on FatalAdapterError", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    (adapter.connect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new FatalAdapterError("Codespace 'env1' not found — it may have been deleted"),
    );
    adapterManager.registerAdapter(adapter);

    // Initialize state and attempt once
    await attemptReconnects();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    expect(envRegistry.getEnvironment("env1")?.status).toBe("error");
    expect(adapter.connect).toHaveBeenCalledTimes(1);

    // Additional ticks must not trigger another attempt because the env is now in "error"
    // status, so attemptReconnects() should not select it again.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    // Even if reconnect state was cleared, no additional connect occurs because the
    // environment remains marked as "error".
    expect(adapter.connect).toHaveBeenCalledTimes(1);
  });

  it("emits environment.changed twice on FatalAdapterError (connecting + error)", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    (adapter.connect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new FatalAdapterError("resource gone"),
    );
    adapterManager.registerAdapter(adapter);

    vi.mocked(emit).mockClear();

    // Initialize + attempt
    await attemptReconnects();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15_000);
    await attemptReconnects();
    await new Promise((r) => setTimeout(r, 50));

    // connectAndRecover emits once for "connecting", then tryReconnect emits once
    // for the fatal error. Total = 2 (one for → connecting, one for → error).
    const fatalEmitCount = vi.mocked(emit).mock.calls.filter(
      ([type]) => type === "environment.changed",
    ).length;
    expect(fatalEmitCount).toBe(2);
    expect(envRegistry.getEnvironment("env1")?.status).toBe("error");
  });

  // ── isReconnecting ────────────────────────────────────────

  it("isReconnecting returns false when no reconnect is in flight", () => {
    expect(isReconnecting("env-never-seen")).toBe(false);
    expect(isReconnecting("env1")).toBe(false);
  });

  it("isReconnecting returns true while a reconnect attempt is in progress", async () => {
    insertEnv("env1");
    const adapter = makeAdapter();
    let resolveConnect!: () => void;
    (adapter.connect as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<PowerLineConnection>((resolve) => {
        resolveConnect = () => resolve({
          client: {} as PowerLineConnection["client"],
          environmentId: "env1",
          port: 7433,
        });
      }),
    );
    adapterManager.registerAdapter(adapter);

    // Initialize with no delay
    resetReconnectState("env1");
    const reconnectPromise = attemptReconnects();

    // Wait until adapter.connect has been called (resolveConnect is assigned).
    // At that point env1 is in the reconnecting Set, so both assertions hold.
    await vi.waitFor(() => expect(resolveConnect).toBeTypeOf("function"));
    expect(isReconnecting("env1")).toBe(true);

    // Resolve the connect call and let reconnect finish
    resolveConnect();
    await reconnectPromise;

    // Wait until the reconnect completes and env1 is removed from the Set
    await vi.waitFor(() => expect(isReconnecting("env1")).toBe(false));
  });
});
