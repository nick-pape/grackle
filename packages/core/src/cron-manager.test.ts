import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { CronManager, type CronManagerDeps } from "./cron-manager.js";
import type { ScheduleRow } from "@grackle-ai/database";
import type { EnvironmentRow } from "@grackle-ai/database";

function makeSchedule(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: "sched-1",
    title: "Test Schedule",
    description: "",
    scheduleExpression: "30s",
    personaId: "persona-1",
    environmentId: "",
    workspaceId: "",
    parentTaskId: "",
    enabled: true,
    lastRunAt: null,
    nextRunAt: "2026-03-25T10:00:00Z",
    runCount: 0,
    createdAt: "2026-03-25T09:59:30Z",
    updatedAt: "2026-03-25T09:59:30Z",
    ...overrides,
  };
}

function makeEnv(overrides: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    id: "local-env",
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

function createMockDeps(): CronManagerDeps {
  return {
    getDueSchedules: vi.fn().mockReturnValue([]),
    advanceSchedule: vi.fn(),
    createTask: vi.fn(),
    setTaskScheduleId: vi.fn(),
    startTaskSession: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    findFirstConnectedEnvironment: vi.fn().mockReturnValue(makeEnv()),
    getPersona: vi.fn().mockReturnValue({ id: "persona-1", name: "Test", runtime: "stub" }),
    getTask: vi.fn().mockReturnValue({ id: "task-1", title: "Test Task" }),
    setScheduleEnabled: vi.fn(),
    isEnvironmentConnected: vi.fn().mockReturnValue(true),
  };
}

describe("CronManager", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-25T10:00:05Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── UT-1: Ticker starts and invokes tick on interval ────

  it("starts and invokes tick on interval", async () => {
    const deps = createMockDeps();
    const mgr = new CronManager(deps, 50);
    mgr.start();

    // Advance past 3 ticks
    await vi.advanceTimersByTimeAsync(160);

    await mgr.stop();
    expect(deps.getDueSchedules).toHaveBeenCalled();
    expect(vi.mocked(deps.getDueSchedules).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  // ── UT-2: Ticker stops cleanly ──────────────────────────

  it("stops cleanly with no further ticks", async () => {
    const deps = createMockDeps();
    const mgr = new CronManager(deps, 50);
    mgr.start();

    await vi.advanceTimersByTimeAsync(60);
    const callsBefore = vi.mocked(deps.getDueSchedules).mock.calls.length;

    await mgr.stop();
    await vi.advanceTimersByTimeAsync(200);

    expect(vi.mocked(deps.getDueSchedules).mock.calls.length).toBe(callsBefore);
  });

  // ── UT-3: In-flight tick completes before stop resolves ─

  it("awaits in-flight tick before stop resolves", async () => {
    const deps = createMockDeps();
    let resolveStartTask!: () => void;
    vi.mocked(deps.getDueSchedules).mockReturnValue([makeSchedule()]);
    vi.mocked(deps.startTaskSession).mockImplementation(
      () => new Promise<undefined>((r) => { resolveStartTask = () => r(undefined); }),
    );

    const mgr = new CronManager(deps, 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60); // trigger tick

    let stopped = false;
    const stopPromise = mgr.stop().then(() => { stopped = true; });

    // stop should NOT resolve while startTaskSession is pending
    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false);

    // Complete the pending task start
    resolveStartTask();
    await stopPromise;
    expect(stopped).toBe(true);
  });

  // ── UT-4: Ticks do not overlap ──────────────────────────

  it("does not overlap ticks", async () => {
    const deps = createMockDeps();
    let tickCount = 0;
    let maxConcurrent = 0;
    let concurrent = 0;

    vi.mocked(deps.getDueSchedules).mockImplementation(() => {
      concurrent++;
      tickCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return [];
    });

    // We need a way to detect overlap. Since getDueSchedules is sync,
    // overlap would mean concurrent > 1. Let's use a slow async path instead.
    vi.mocked(deps.getDueSchedules).mockReturnValue([makeSchedule()]);
    let resolveTask!: () => void;
    vi.mocked(deps.startTaskSession).mockImplementation(() => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return new Promise<undefined>((r) => {
        resolveTask = () => { concurrent--; r(undefined); };
      });
    });

    const mgr = new CronManager(deps, 50);
    mgr.start();

    // Trigger first tick
    await vi.advanceTimersByTimeAsync(60);
    // Tick is now in-flight (startTaskSession pending)

    // Advance past second tick interval — should NOT trigger because first is still running
    await vi.advanceTimersByTimeAsync(60);

    expect(maxConcurrent).toBe(1);

    resolveTask();
    await mgr.stop();
  });

  // ── UT-5: Due schedule fires correctly ──────────────────

  it("fires a due schedule — creates task, starts session, advances", async () => {
    const deps = createMockDeps();
    const schedule = makeSchedule();
    vi.mocked(deps.getDueSchedules).mockReturnValue([schedule]);

    const mgr = new CronManager(deps, 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();

    // Task created
    expect(deps.createTask).toHaveBeenCalledTimes(1);
    const createArgs = vi.mocked(deps.createTask).mock.calls[0];
    expect(createArgs[0]).toBeTruthy(); // task ID (UUID)

    // scheduleId FK set
    expect(deps.setTaskScheduleId).toHaveBeenCalledWith(
      createArgs[0],
      "sched-1",
    );

    // Session started
    expect(deps.startTaskSession).toHaveBeenCalledTimes(1);

    // Schedule advanced
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
  });

  // ── UT-7: Fire failure does not crash the tick ──────────

  it("continues firing other schedules when one fails", async () => {
    const deps = createMockDeps();
    const s1 = makeSchedule({ id: "s1", personaId: "missing-persona" });
    const s2 = makeSchedule({ id: "s2" });
    vi.mocked(deps.getDueSchedules).mockReturnValue([s1, s2]);
    vi.mocked(deps.getPersona).mockImplementation((id: string) => {
      if (id === "missing-persona") { return undefined; }
      return { id: "persona-1", name: "Test", runtime: "stub" } as ReturnType<CronManagerDeps["getPersona"]>;
    });

    const mgr = new CronManager(deps, 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();

    // s1 failed (no persona) but s2 should still fire
    expect(deps.createTask).toHaveBeenCalledTimes(1); // only s2
    // s1's schedule should still advance (prevent retry storms)
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(2); // both advanced
  });

  // ── UT-11: schedule.fired event emitted ─────────────────

  it("emits schedule.fired event on successful fire", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([makeSchedule()]);

    const mgr = new CronManager(deps, 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();

    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({ scheduleId: "sched-1" }),
    );
  });

  // ── UT-12: Environment auto-selection prefers local ─────

  it("uses explicit environmentId from schedule when provided", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([
      makeSchedule({ environmentId: "explicit-env" }),
    ]);

    const mgr = new CronManager(deps, 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();

    // Should NOT call findFirstConnectedEnvironment
    expect(deps.findFirstConnectedEnvironment).not.toHaveBeenCalled();
    // Should use explicit env
    expect(deps.startTaskSession).toHaveBeenCalledWith(
      undefined,
      expect.anything(),
      expect.objectContaining({ environmentId: "explicit-env" }),
    );
  });

  it("auto-selects environment when schedule has no environmentId", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([makeSchedule({ environmentId: "" })]);

    const mgr = new CronManager(deps, 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();

    expect(deps.findFirstConnectedEnvironment).toHaveBeenCalled();
    expect(deps.startTaskSession).toHaveBeenCalledWith(
      undefined,
      expect.anything(),
      expect.objectContaining({ environmentId: "local-env" }),
    );
  });

  it("fails gracefully when no environment is connected", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([makeSchedule()]);
    vi.mocked(deps.findFirstConnectedEnvironment).mockReturnValue(undefined);

    const mgr = new CronManager(deps, 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();

    // Should NOT create task or start session
    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.startTaskSession).not.toHaveBeenCalled();
    // Should still advance schedule (prevent retry storms)
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
  });
});
