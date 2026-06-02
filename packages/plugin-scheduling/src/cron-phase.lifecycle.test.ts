/**
 * Cron-phase heartbeat lifecycle walk (#1438 hardening).
 *
 * Exhaustively walks the heartbeat decision tree's reachable states and
 * asserts the precise dep-call shape, emit shape, and post-tick state for
 * every cell. Built to surface integration-surface bugs of the same class
 * Copilot caught on first review (pause/resume `nextRunAt` semantics, the
 * deleteTask FK cascade — both at cross-store seams).
 *
 * Why this and not the existing cron-phase.test.ts: that file covers happy
 * paths with one assertion shape per case. This file enumerates every
 * branch + state combination and locks in the contract that callers (the
 * cron-phase wire-up at scheduling-plugin.ts) rely on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "pino";

import { createCronPhase, type CronPhaseDeps } from "./cron-phase.js";
import { SESSION_STATUS } from "@grackle-ai/common";
import type { ScheduleRow, SessionRow, TaskRow } from "@grackle-ai/database";

// ── Fixtures ─────────────────────────────────────────────────────────

// Use the canonical toISOString shape (with ms) — that's what cron-phase
// constructs internally with `new Date().toISOString()`.
const NOW = new Date("2026-03-25T10:00:05Z").toISOString();
const HEARTBEAT_TASK_ID = "task-A";
const HEARTBEAT_TASK: TaskRow = { id: HEARTBEAT_TASK_ID, title: "Agent Root" } as TaskRow;

function makeSchedule(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: "sched-1",
    title: "Test Schedule",
    description: "PING",
    scheduleExpression: "30s",
    personaId: "persona-1",
    workspaceId: "",
    parentTaskId: "",
    enabled: true,
    lastRunAt: null,
    nextRunAt: "2026-03-25T10:00:00Z",
    runCount: 0,
    taskId: null,
    createdAt: "2026-03-25T09:59:30Z",
    updatedAt: "2026-03-25T09:59:30Z",
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "sess-1",
    taskId: HEARTBEAT_TASK_ID,
    status: SESSION_STATUS.STOPPED,
    runtimeSessionId: "rt-1",
    ...overrides,
  } as SessionRow;
}

function createMockDeps(): CronPhaseDeps {
  return {
    getDueSchedules: vi.fn().mockReturnValue([]),
    advanceSchedule: vi.fn(),
    createTask: vi.fn(),
    setTaskScheduleId: vi.fn(),
    enqueueForDispatch: vi.fn(),
    emit: vi.fn(),
    getPersona: vi.fn().mockReturnValue({ id: "persona-1", name: "Test", runtime: "stub" }),
    setScheduleEnabled: vi.fn(),
    getTask: vi.fn(),
    getLatestSessionForTask: vi.fn(),
    reanimateAgent: vi.fn().mockResolvedValue(undefined),
    publishToStdin: vi.fn(),
    startTaskSession: vi.fn().mockResolvedValue(undefined),
    resolveEnvironment: vi.fn().mockReturnValue("env-1"),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Pick<Logger, "debug" | "info" | "warn" | "error">,
  };
}

/** Wire `deps.getDueSchedules` to return `[schedule]` and run the cron tick. */
async function tick(deps: CronPhaseDeps, schedule: ScheduleRow): Promise<void> {
  vi.mocked(deps.getDueSchedules).mockReturnValue([schedule]);
  await createCronPhase(deps).execute();
}

/** Convenience: assert a dep was NOT called at all. */
function expectNotCalled(fn: unknown): void {
  expect(fn).not.toHaveBeenCalled();
}

// ── Tests ────────────────────────────────────────────────────────────

describe("cron-phase lifecycle walk", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(NOW) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Heartbeat path: cadence parse failure ────────────────────────

  it("[H-1] invalid cadence on a heartbeat schedule → setScheduleEnabled(false, null), no other deps", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID, scheduleExpression: "garbage" }));

    expect(deps.setScheduleEnabled).toHaveBeenCalledWith("sched-1", false, null);
    expectNotCalled(deps.getTask);
    expectNotCalled(deps.getLatestSessionForTask);
    expectNotCalled(deps.reanimateAgent);
    expectNotCalled(deps.publishToStdin);
    expectNotCalled(deps.startTaskSession);
    expectNotCalled(deps.advanceSchedule);
    expectNotCalled(deps.emit);
  });

  // ── Heartbeat path: target task missing ──────────────────────────

  it("[H-2] target task missing → setScheduleEnabled(false, null), no fire", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(undefined);
    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID }));

    expect(deps.getTask).toHaveBeenCalledWith(HEARTBEAT_TASK_ID);
    expect(deps.setScheduleEnabled).toHaveBeenCalledWith("sched-1", false, null);
    expectNotCalled(deps.getLatestSessionForTask);
    expectNotCalled(deps.reanimateAgent);
    expectNotCalled(deps.publishToStdin);
    expectNotCalled(deps.startTaskSession);
    expectNotCalled(deps.advanceSchedule);
    expectNotCalled(deps.emit);
  });

  // ── Heartbeat path: overrun skip (every ALIVE session status) ────

  const ALIVE_STATUSES = [
    SESSION_STATUS.PENDING,
    SESSION_STATUS.RUNNING,
    SESSION_STATUS.IDLE,
  ] as const;

  it.each(ALIVE_STATUSES)(
    "[H-3:%s] latest session is alive → skip + advance, no reanimate/spawn",
    async (status) => {
      const deps = createMockDeps();
      vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
      vi.mocked(deps.getLatestSessionForTask).mockReturnValue(makeSession({ status }));
      await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID }));

      expect(deps.advanceSchedule).toHaveBeenCalledWith("sched-1", NOW, expect.any(String));
      expectNotCalled(deps.reanimateAgent);
      expectNotCalled(deps.publishToStdin);
      expectNotCalled(deps.startTaskSession);
      expectNotCalled(deps.emit);
      expectNotCalled(deps.setScheduleEnabled);
    },
  );

  // ── Heartbeat path: reanimate success ────────────────────────────

  it("[H-4] latest STOPPED + reanimate succeeds → publishToStdin(description), advance, emit mode=reanimate", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(
      makeSession({ status: SESSION_STATUS.STOPPED }),
    );
    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID, description: "PING-BYTES" }));

    expect(deps.reanimateAgent).toHaveBeenCalledTimes(1);
    expect(deps.reanimateAgent).toHaveBeenCalledWith("sess-1");
    expect(deps.publishToStdin).toHaveBeenCalledTimes(1);
    expect(deps.publishToStdin).toHaveBeenCalledWith("sess-1", "PING-BYTES");
    expect(deps.advanceSchedule).toHaveBeenCalledWith("sched-1", NOW, expect.any(String));
    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({
        scheduleId: "sched-1",
        taskId: HEARTBEAT_TASK_ID,
        sessionId: "sess-1",
        mode: "reanimate",
        firedAt: NOW,
      }),
    );
    expectNotCalled(deps.startTaskSession);
    expectNotCalled(deps.setScheduleEnabled);
  });

  // ── Heartbeat path: reanimate failure modes → fresh-spawn fallback

  it("[H-5a] reanimate throws FailedPrecondition → fresh-spawn, emit mode=fresh-spawn", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(
      makeSession({ status: SESSION_STATUS.STOPPED }),
    );
    vi.mocked(deps.reanimateAgent).mockRejectedValueOnce(
      new Error("FailedPrecondition: env offline"),
    );

    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID, description: "PING" }));

    expect(deps.reanimateAgent).toHaveBeenCalledWith("sess-1");
    expect(deps.startTaskSession).toHaveBeenCalledWith(
      HEARTBEAT_TASK,
      expect.objectContaining({
        rawPrompt: "PING",
        personaId: "persona-1",
        environmentId: "env-1",
      }),
    );
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({ mode: "fresh-spawn" }),
    );
    // The fresh-spawn-fallback emit shape intentionally omits sessionId
    // (no per-session identity exists until startTaskSession returns).
    const emitArgs = vi
      .mocked(deps.emit)
      .mock.calls.find((c) => c[0] === "schedule.fired")![1] as Record<string, unknown>;
    expect(emitArgs).not.toHaveProperty("sessionId");
    expectNotCalled(deps.publishToStdin);
  });

  it("[H-5b] reanimate throws NotFound → fresh-spawn, emit mode=fresh-spawn", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(
      makeSession({ status: SESSION_STATUS.STOPPED }),
    );
    vi.mocked(deps.reanimateAgent).mockRejectedValueOnce(new Error("NotFound: session vanished"));

    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID }));

    expect(deps.startTaskSession).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({ mode: "fresh-spawn" }),
    );
  });

  it("[H-5c] reanimate throws + fresh-spawn ALSO fails → advance, NO emit (work didn't start)", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(
      makeSession({ status: SESSION_STATUS.STOPPED }),
    );
    vi.mocked(deps.reanimateAgent).mockRejectedValueOnce(new Error("env offline"));
    vi.mocked(deps.startTaskSession).mockResolvedValueOnce("Environment not connected: env-1");

    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID }));

    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
    expectNotCalled(deps.emit);
    expectNotCalled(deps.publishToStdin);
    // Schedule stays enabled — failures are transient, the schedule keeps trying.
    expectNotCalled(deps.setScheduleEnabled);
  });

  // ── Heartbeat path: no latest session at all (first wake) ────────

  it("[H-6] no latest session → fresh-spawn (no reanimate attempt), emit mode=fresh-spawn", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(undefined);

    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID, description: "PING" }));

    expectNotCalled(deps.reanimateAgent);
    expectNotCalled(deps.publishToStdin);
    expect(deps.startTaskSession).toHaveBeenCalledWith(
      HEARTBEAT_TASK,
      expect.objectContaining({ rawPrompt: "PING" }),
    );
    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({ mode: "fresh-spawn" }),
    );
  });

  it("[H-7] no latest + fresh-spawn fails → advance, NO emit", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(undefined);
    vi.mocked(deps.startTaskSession).mockResolvedValueOnce("Environment ID is required");

    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID }));

    expect(deps.startTaskSession).toHaveBeenCalledTimes(1);
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
    expectNotCalled(deps.emit);
  });

  // ── Heartbeat path: env-resolution shape ─────────────────────────

  it("[H-8] resolveEnvironment is called with the target task (not the schedule)", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(undefined);

    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID }));

    expect(deps.resolveEnvironment).toHaveBeenCalledTimes(1);
    expect(deps.resolveEnvironment).toHaveBeenCalledWith(HEARTBEAT_TASK);
  });

  it("[H-9] resolveEnvironment returning undefined still attempts startTaskSession (caller handles failure)", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(undefined);
    vi.mocked(deps.resolveEnvironment).mockReturnValueOnce(undefined);
    vi.mocked(deps.startTaskSession).mockResolvedValueOnce("Environment ID is required");

    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID }));

    expect(deps.startTaskSession).toHaveBeenCalledWith(
      HEARTBEAT_TASK,
      expect.objectContaining({ environmentId: undefined }),
    );
    expectNotCalled(deps.emit);
  });

  // ── Heartbeat path: nextRunAt drift-anchoring ────────────────────

  it("[H-10] nextRunAt is drift-anchored to schedule.lastRunAt (when set)", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(undefined);

    // 30s after lastRunAt = the anchored next-run.
    await tick(
      deps,
      makeSchedule({
        taskId: HEARTBEAT_TASK_ID,
        lastRunAt: "2026-03-25T10:00:00Z",
      }),
    );

    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
    const [, advNow, advNext] = vi.mocked(deps.advanceSchedule).mock.calls[0]!;
    expect(advNow).toBe(NOW);
    // Anchored next-run: lastRunAt + 30s = 10:00:30Z.
    expect(advNext).toBe(new Date("2026-03-25T10:00:30Z").toISOString());
  });

  // ── Heartbeat path: stop-on-no-runtime-session-id (manifests as reanimate throw) ─

  it("[H-11] latest STOPPED with no runtimeSessionId surfaces via reanimate throwing; falls back to fresh-spawn", async () => {
    // The real reanimateAgent throws FailedPrecondition when runtimeSessionId
    // is empty — the mock here simulates that. Tests the contract, not the impl.
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(
      makeSession({ status: SESSION_STATUS.STOPPED, runtimeSessionId: "" }),
    );
    vi.mocked(deps.reanimateAgent).mockRejectedValueOnce(
      new Error("FailedPrecondition: no runtime session id"),
    );

    await tick(deps, makeSchedule({ taskId: HEARTBEAT_TASK_ID }));

    expect(deps.startTaskSession).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({ mode: "fresh-spawn" }),
    );
  });

  // ── Fresh-task path: discriminator regression guard ──────────────

  it("[F-1] taskId=null routes to the fresh-task path (createTask, enqueue, emit without `mode`)", async () => {
    const deps = createMockDeps();
    await tick(deps, makeSchedule({ taskId: null }));

    expect(deps.createTask).toHaveBeenCalledTimes(1);
    expect(deps.enqueueForDispatch).toHaveBeenCalledTimes(1);
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
    // Fresh-task emits without a `mode` field — distinguishable on the wire from heartbeats.
    const emitCall = vi.mocked(deps.emit).mock.calls.find((c) => c[0] === "schedule.fired")!;
    expect(emitCall[1]).not.toHaveProperty("mode");
    expectNotCalled(deps.reanimateAgent);
    expectNotCalled(deps.publishToStdin);
    expectNotCalled(deps.startTaskSession);
    expectNotCalled(deps.getTask);
    expectNotCalled(deps.getLatestSessionForTask);
  });

  it("[F-2] fresh-task: invalid cadence → disable, no createTask", async () => {
    const deps = createMockDeps();
    await tick(deps, makeSchedule({ taskId: null, scheduleExpression: "garbage" }));

    expect(deps.setScheduleEnabled).toHaveBeenCalledWith("sched-1", false, null);
    expectNotCalled(deps.createTask);
    expectNotCalled(deps.advanceSchedule);
    expectNotCalled(deps.emit);
  });

  it("[F-3] fresh-task: persona missing → advance but no createTask + no emit", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getPersona).mockReturnValue(undefined);
    await tick(deps, makeSchedule({ taskId: null }));

    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
    expectNotCalled(deps.createTask);
    expectNotCalled(deps.enqueueForDispatch);
    expectNotCalled(deps.emit);
  });

  it("[F-4] fresh-task: createTask throws → caught by outer try/catch → advance, NO emit", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.createTask).mockImplementationOnce(() => {
      throw new Error("DB write failed");
    });
    await tick(deps, makeSchedule({ taskId: null }));

    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
    expectNotCalled(deps.emit);
  });

  // ── Cross-path invariant: discriminator is purely structural ─────

  it("[X-1] same schedule with taskId=null vs taskId=<x> takes different paths", async () => {
    const depsHB = createMockDeps();
    vi.mocked(depsHB.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(depsHB.getLatestSessionForTask).mockReturnValue(undefined);
    await tick(depsHB, makeSchedule({ taskId: HEARTBEAT_TASK_ID }));

    const depsFT = createMockDeps();
    await tick(depsFT, makeSchedule({ taskId: null }));

    // Heartbeat path: fresh-spawn via startTaskSession.
    expect(depsHB.startTaskSession).toHaveBeenCalledTimes(1);
    expectNotCalled(depsHB.createTask);

    // Fresh-task path: createTask + enqueue.
    expect(depsFT.createTask).toHaveBeenCalledTimes(1);
    expectNotCalled(depsFT.startTaskSession);
  });

  // ── Multi-schedule batch: heartbeat + fresh-task on the same tick ─

  it("[X-2] a tick with both a heartbeat and a fresh-task schedule fires each on its own path", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(undefined);

    const hb = makeSchedule({ id: "hb", taskId: HEARTBEAT_TASK_ID });
    const ft = makeSchedule({ id: "ft", taskId: null });
    vi.mocked(deps.getDueSchedules).mockReturnValue([hb, ft]);
    await createCronPhase(deps).execute();

    expect(deps.startTaskSession).toHaveBeenCalledTimes(1); // heartbeat
    expect(deps.createTask).toHaveBeenCalledTimes(1); // fresh-task
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(2);
    expect(deps.emit).toHaveBeenCalledTimes(2);
  });

  // ── Multi-schedule batch: a heartbeat throw doesn't poison subsequent fires ─

  it("[X-3] a heartbeat firing with a transient failure doesn't block the next schedule", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getTask).mockReturnValue(HEARTBEAT_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(
      makeSession({ status: SESSION_STATUS.STOPPED }),
    );
    vi.mocked(deps.reanimateAgent).mockRejectedValueOnce(new Error("transient"));
    vi.mocked(deps.startTaskSession).mockResolvedValueOnce("env down");

    const hb = makeSchedule({ id: "hb", taskId: HEARTBEAT_TASK_ID });
    const ft = makeSchedule({ id: "ft", taskId: null });
    vi.mocked(deps.getDueSchedules).mockReturnValue([hb, ft]);
    await createCronPhase(deps).execute();

    // Heartbeat advanced but didn't emit (work failed).
    // Fresh-task ran cleanly behind it.
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(2);
    expect(deps.createTask).toHaveBeenCalledTimes(1);
    // Only one emit — the fresh-task one (no `mode` field).
    const fires = vi.mocked(deps.emit).mock.calls.filter((c) => c[0] === "schedule.fired");
    expect(fires).toHaveLength(1);
    expect(fires[0]![1]).not.toHaveProperty("mode");
  });
});
