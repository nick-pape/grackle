/**
 * Tests for root task boot with reanimate-first strategy and exponential backoff.
 * Covers: skip conditions, reanimate-first, backoff timing, error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createRootTaskBoot, _resetForTesting, type RootTaskBootDeps } from "./root-task-boot.js";
import type { TaskRow, SessionRow, EnvironmentRow } from "@grackle-ai/database";
import { TASK_STATUS, ROOT_TASK_ID, ROOT_TASK_INITIAL_PROMPT } from "@grackle-ai/common";
import type { TaskStatusResult } from "./compute-task-status.js";

// ── Factories ───────────────────────────────────────────────

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: ROOT_TASK_ID,
    workspaceId: "default",
    title: "System",
    description: "",
    status: "not_started",
    branch: "system",
    dependsOn: "[]",
    startedAt: null,
    completedAt: null,
    createdAt: "2026-03-25T09:00:00Z",
    updatedAt: "2026-03-25T09:00:00Z",
    sortOrder: 0,
    parentTaskId: "",
    depth: 0,
    canDecompose: true,
    defaultPersonaId: "system",
    workpad: "",
    scheduleId: "",
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "sess-1",
    environmentId: "env-local",
    runtime: "claude-code",
    runtimeSessionId: "rt-abc-123",
    prompt: "test",
    model: "sonnet",
    status: "stopped",
    logPath: "/tmp/log",
    turns: 5,
    startedAt: "2026-03-25T09:30:00Z",
    suspendedAt: null,
    endedAt: "2026-03-25T09:35:00Z",
    endReason: "completed",
    error: null,
    taskId: ROOT_TASK_ID,
    personaId: "system",
    parentSessionId: "",
    pipeMode: "",
    inputTokens: 100,
    outputTokens: 200,
    costUsd: 0.01,
    sigtermSentAt: null,
    ...overrides,
  };
}

function makeEnv(overrides: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    id: "env-local",
    displayName: "Local",
    adapterType: "local",
    adapterConfig: "{}",
    defaultRuntime: "claude-code",
    bootstrapped: true,
    status: "connected",
    lastSeen: null,
    envInfo: null,
    createdAt: "2026-03-25T09:00:00Z",
    powerlineToken: "abc",
    ...overrides,
  };
}

function createMockDeps(): RootTaskBootDeps {
  return {
    getTask: vi.fn().mockReturnValue(makeTask()),
    listSessionsForTask: vi.fn().mockReturnValue([]),
    getLatestSessionForTask: vi.fn().mockReturnValue(undefined),
    computeTaskStatus: vi.fn().mockReturnValue({ status: TASK_STATUS.NOT_STARTED, latestSessionId: "" } satisfies TaskStatusResult),
    findFirstConnectedEnvironment: vi.fn().mockReturnValue(makeEnv()),
    startTaskSession: vi.fn().mockResolvedValue(undefined),
    reanimateAgent: vi.fn().mockReturnValue(makeSession({ status: "running" })),
  };
}

// ── Tests ───────────────────────────────────────────────────

describe("createRootTaskBoot", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-27T10:00:00Z") });
    _resetForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Skip conditions ──────────────────────────────────────

  describe("skip conditions", () => {
    it("skips when root task does not exist in DB", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.getTask).mockReturnValue(undefined);

      const boot = createRootTaskBoot(deps);
      await boot();

      expect(deps.startTaskSession).not.toHaveBeenCalled();
      expect(deps.reanimateAgent).not.toHaveBeenCalled();
    });

    it("skips when root task is already WORKING", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.computeTaskStatus).mockReturnValue({ status: TASK_STATUS.WORKING, latestSessionId: "sess-1" });

      const boot = createRootTaskBoot(deps);
      await boot();

      expect(deps.startTaskSession).not.toHaveBeenCalled();
      expect(deps.reanimateAgent).not.toHaveBeenCalled();
    });

    it("skips when no connected environment exists", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.findFirstConnectedEnvironment).mockReturnValue(undefined);

      const boot = createRootTaskBoot(deps);
      await boot();

      expect(deps.startTaskSession).not.toHaveBeenCalled();
      expect(deps.reanimateAgent).not.toHaveBeenCalled();
    });

    it("prevents concurrent boot attempts", async () => {
      const deps = createMockDeps();
      // startTaskSession blocks until we resolve it
      let resolveStart!: () => void;
      vi.mocked(deps.startTaskSession).mockImplementation(
        () => new Promise((resolve) => { resolveStart = () => resolve(undefined); }),
      );

      const boot = createRootTaskBoot(deps);
      const p1 = boot();
      const p2 = boot(); // should be skipped — inProgress guard

      resolveStart();
      await Promise.all([p1, p2]);

      expect(deps.startTaskSession).toHaveBeenCalledTimes(1);
    });
  });

  // ── Reanimate-first strategy ─────────────────────────────

  describe("reanimate-first strategy", () => {
    it("reanimates when latest session has runtimeSessionId", async () => {
      const deps = createMockDeps();
      const session = makeSession({ runtimeSessionId: "rt-abc-123", status: "stopped" });
      vi.mocked(deps.getLatestSessionForTask).mockReturnValue(session);

      const boot = createRootTaskBoot(deps);
      await boot();

      expect(deps.reanimateAgent).toHaveBeenCalledWith(session.id);
      expect(deps.startTaskSession).not.toHaveBeenCalled();
    });

    it("falls back to fresh spawn when reanimate throws", async () => {
      const deps = createMockDeps();
      const session = makeSession({ runtimeSessionId: "rt-abc-123", status: "stopped" });
      vi.mocked(deps.getLatestSessionForTask).mockReturnValue(session);
      vi.mocked(deps.reanimateAgent).mockImplementation(() => { throw new Error("SDK session expired"); });

      const boot = createRootTaskBoot(deps);
      await boot();

      expect(deps.reanimateAgent).toHaveBeenCalledWith(session.id);
      expect(deps.startTaskSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: ROOT_TASK_ID }),
        expect.objectContaining({ notes: ROOT_TASK_INITIAL_PROMPT }),
      );
    });

    it("falls back to fresh spawn when latest session has no runtimeSessionId", async () => {
      const deps = createMockDeps();
      const session = makeSession({ runtimeSessionId: null, status: "stopped" });
      vi.mocked(deps.getLatestSessionForTask).mockReturnValue(session);

      const boot = createRootTaskBoot(deps);
      await boot();

      expect(deps.reanimateAgent).not.toHaveBeenCalled();
      expect(deps.startTaskSession).toHaveBeenCalled();
    });

    it("fresh-spawns on first boot when no sessions exist", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.getLatestSessionForTask).mockReturnValue(undefined);

      const boot = createRootTaskBoot(deps);
      await boot();

      expect(deps.reanimateAgent).not.toHaveBeenCalled();
      expect(deps.startTaskSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: ROOT_TASK_ID }),
        expect.objectContaining({
          environmentId: "env-local",
          notes: ROOT_TASK_INITIAL_PROMPT,
        }),
      );
    });
  });

  // ── Exponential backoff ──────────────────────────────────

  describe("exponential backoff", () => {
    it("allows immediate retry on first call (no prior failures)", async () => {
      const deps = createMockDeps();

      const boot = createRootTaskBoot(deps);
      await boot();

      expect(deps.startTaskSession).toHaveBeenCalledTimes(1);
    });

    it("applies backoff delay after a failure", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.startTaskSession).mockResolvedValue("connection refused");

      const boot = createRootTaskBoot(deps);

      // First call fails → records failure
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(1);

      // Immediate second call → throttled (1s backoff not elapsed)
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(1); // not called again

      // Advance past 1s backoff
      vi.advanceTimersByTime(1_000);
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(2);
    });

    it("doubles backoff delay after consecutive failures", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.startTaskSession).mockResolvedValue("connection refused");

      const boot = createRootTaskBoot(deps);

      // Failure 1 → next backoff = 1s * 2^0 = 1s
      await boot();

      // Advance 1s and try again → failure 2 → next backoff = 1s * 2^1 = 2s
      vi.advanceTimersByTime(1_000);
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(2);

      // Try after only 1s → still throttled (need 2s)
      vi.advanceTimersByTime(1_000);
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(2); // not called

      // Advance another 1s (total 2s) → allowed
      vi.advanceTimersByTime(1_000);
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(3);
    });

    it("caps delay at BOOT_MAX_DELAY_MS (60s)", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.startTaskSession).mockResolvedValue("connection refused");

      const boot = createRootTaskBoot(deps);

      // Simulate many failures to push backoff past the cap
      // failure 1: backoff = 1s * 2^0 = 1s
      await boot();
      vi.advanceTimersByTime(1_000);
      // failure 2: backoff = 1s * 2^1 = 2s
      await boot();
      vi.advanceTimersByTime(2_000);
      // failure 3: backoff = 1s * 2^2 = 4s
      await boot();
      vi.advanceTimersByTime(4_000);
      // failure 4: backoff = 1s * 2^3 = 8s
      await boot();

      expect(deps.startTaskSession).toHaveBeenCalledTimes(4);

      // After 4 failures, next backoff = min(1000 * 2^3 = 8s, 60s) = 8s
      vi.advanceTimersByTime(8_000);
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(5);
    });

    it("stops retrying after BOOT_MAX_FAILURES (5)", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.startTaskSession).mockResolvedValue("connection refused");

      const boot = createRootTaskBoot(deps);

      // Burn through 5 failures with sufficient time between each
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(60_000); // always past max delay
        await boot();
      }
      expect(deps.startTaskSession).toHaveBeenCalledTimes(5);

      // 6th attempt should be blocked — max failures reached
      vi.advanceTimersByTime(60_000);
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(5); // not called again
    });

    it("resets backoff when root task has been WORKING for >30s", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.startTaskSession).mockResolvedValue("connection refused");

      const boot = createRootTaskBoot(deps);

      // First failure
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(1);

      // Now the session succeeds externally (e.g., session recovery reanimated it)
      vi.mocked(deps.startTaskSession).mockResolvedValue(undefined);
      vi.mocked(deps.computeTaskStatus).mockReturnValue({ status: TASK_STATUS.WORKING, latestSessionId: "sess-2" });

      // Boot sees WORKING → sets lastSessionStartedAt
      vi.advanceTimersByTime(2_000);
      await boot();

      // Advance past stability threshold (30s)
      vi.advanceTimersByTime(31_000);

      // Boot sees WORKING again → resets backoff
      await boot();

      // Now simulate a crash — task goes back to PAUSED
      vi.mocked(deps.computeTaskStatus).mockReturnValue({ status: TASK_STATUS.PAUSED, latestSessionId: "sess-2" });
      vi.mocked(deps.startTaskSession).mockResolvedValue(undefined);

      // Should be able to start immediately (backoff was reset)
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(2); // 1 failure + 1 after reset
    });
  });

  // ── Error handling ───────────────────────────────────────

  describe("error handling", () => {
    it("increments failure count when startTaskSession returns error string", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.startTaskSession).mockResolvedValue("Environment not connected");

      const boot = createRootTaskBoot(deps);
      await boot();

      // Second immediate call should be throttled (failure was recorded)
      await boot();
      expect(deps.startTaskSession).toHaveBeenCalledTimes(1);
    });

    it("does not increment failure count when reanimate succeeds", async () => {
      const deps = createMockDeps();
      const session = makeSession({ runtimeSessionId: "rt-abc-123", status: "stopped" });
      vi.mocked(deps.getLatestSessionForTask).mockReturnValue(session);

      const boot = createRootTaskBoot(deps);
      await boot();

      // Now simulate a second boot (task went non-working again)
      vi.mocked(deps.computeTaskStatus).mockReturnValue({ status: TASK_STATUS.PAUSED, latestSessionId: "sess-1" });

      // Should be allowed immediately — no backoff since previous attempt succeeded
      await boot();
      expect(deps.reanimateAgent).toHaveBeenCalledTimes(2);
    });

    it("catches unexpected exceptions without crashing", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.getTask).mockImplementation(() => { throw new Error("DB corruption"); });

      const boot = createRootTaskBoot(deps);

      // Should not throw
      await expect(boot()).resolves.toBeUndefined();

      // Should still allow future attempts (inProgress cleared)
      vi.mocked(deps.getTask).mockReturnValue(makeTask());
      vi.advanceTimersByTime(2_000); // past backoff from the failure
      await boot();
      expect(deps.findFirstConnectedEnvironment).toHaveBeenCalled();
    });
  });
});
