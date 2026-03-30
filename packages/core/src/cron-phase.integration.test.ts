import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

// Use real in-memory database
import { openDatabase, initDatabase, seedDatabase, sqlite as _sqlite, taskStore, scheduleStore, personaStore } from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
seedDatabase(_sqlite!);
const sqlite = _sqlite!;

import { createCronPhase, type CronPhaseDeps } from "./cron-phase.js";
import { ReconciliationManager } from "./reconciliation-manager.js";
import { emit } from "./event-bus.js";
import type { EnvironmentRow, TaskRow } from "@grackle-ai/database";

function makeEnv(): EnvironmentRow {
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
    maxConcurrentSessions: 0,
  };
}

describe("Cron phase integration", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-25T10:01:00Z") });
    vi.clearAllMocks();

    // Seed a persona for schedule to reference
    try {
      personaStore.createPersona(
        "stub-persona",
        "Stub",
        "Test persona",
        "You are a test.",
        "{}",
        "stub",
        "sonnet",
        1,
        "[]",
      );
    } catch {
      // Already exists from prior test
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clean up schedules and tasks
    for (const s of scheduleStore.listSchedules()) {
      scheduleStore.deleteSchedule(s.id);
    }
    sqlite.exec("DELETE FROM tasks WHERE id != 'system'");
  });

  it("full flow: schedule fires → task created with scheduleId → session started → schedule advanced", async () => {
    // Create a schedule in the real DB
    const nextRunAt = "2026-03-25T10:00:00Z"; // in the past relative to fake now
    scheduleStore.createSchedule(
      "sched-int-1",
      "Integration Test",
      "Test description",
      "30s",
      "stub-persona",
      "",
      "",
      "",
      nextRunAt,
    );

    // Verify schedule exists
    const before = scheduleStore.getSchedule("sched-int-1");
    expect(before).toBeDefined();
    expect(before!.runCount).toBe(0);
    expect(before!.lastRunAt).toBeNull();

    // Mock only the session start (no real PowerLine)
    const mockStartTaskSession = vi.fn().mockResolvedValue(undefined);

    const deps: CronPhaseDeps = {
      getDueSchedules: scheduleStore.getDueSchedules,
      advanceSchedule: scheduleStore.advanceSchedule,
      createTask: taskStore.createTask,
      setTaskScheduleId: taskStore.setTaskScheduleId,
      startTaskSession: mockStartTaskSession,
      emit: vi.mocked(emit),
      findFirstConnectedEnvironment: vi.fn().mockReturnValue(makeEnv()),
      getPersona: personaStore.getPersona,
      getTask: taskStore.getTask,
      setScheduleEnabled: scheduleStore.setScheduleEnabled,
      isEnvironmentConnected: vi.fn().mockReturnValue(true),
    };

    const cronPhase = createCronPhase(deps);
    const mgr = new ReconciliationManager([cronPhase], 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(60);
    await mgr.stop();

    // Verify task was created in DB with correct scheduleId
    const tasks = sqlite.prepare(
      "SELECT id, title, schedule_id, default_persona_id FROM tasks WHERE schedule_id = 'sched-int-1'",
    ).all() as Array<{ id: string; title: string; schedule_id: string; default_persona_id: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toContain("Integration Test @");
    expect(tasks[0].schedule_id).toBe("sched-int-1");
    expect(tasks[0].default_persona_id).toBe("stub-persona");

    // Verify startTaskSession was called with correct args
    expect(mockStartTaskSession).toHaveBeenCalledTimes(1);
    const [task, options] = mockStartTaskSession.mock.calls[0] as [TaskRow, { environmentId: string; personaId: string }];
    expect(task.id).toBe(tasks[0].id);
    expect(options.environmentId).toBe("local-env");
    expect(options.personaId).toBe("stub-persona");

    // Verify schedule was advanced in DB
    const after = scheduleStore.getSchedule("sched-int-1");
    expect(after!.runCount).toBe(1);
    expect(after!.lastRunAt).toBeTruthy();
    expect(after!.nextRunAt).not.toBe(nextRunAt); // Should have advanced

    // Verify schedule.fired event was emitted
    expect(vi.mocked(emit)).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({
        scheduleId: "sched-int-1",
        taskId: tasks[0].id,
      }),
    );
  });

  it("disabled schedule does not fire", async () => {
    scheduleStore.createSchedule(
      "sched-disabled",
      "Disabled",
      "",
      "30s",
      "stub-persona",
      "",
      "",
      "",
      "2026-03-25T10:00:00Z",
    );
    scheduleStore.setScheduleEnabled("sched-disabled", false, null);

    const mockStartTaskSession = vi.fn().mockResolvedValue(undefined);

    const deps: CronPhaseDeps = {
      getDueSchedules: scheduleStore.getDueSchedules,
      advanceSchedule: scheduleStore.advanceSchedule,
      createTask: taskStore.createTask,
      setTaskScheduleId: taskStore.setTaskScheduleId,
      startTaskSession: mockStartTaskSession,
      emit: vi.mocked(emit),
      findFirstConnectedEnvironment: vi.fn().mockReturnValue(makeEnv()),
      getPersona: personaStore.getPersona,
      getTask: taskStore.getTask,
      setScheduleEnabled: scheduleStore.setScheduleEnabled,
      isEnvironmentConnected: vi.fn().mockReturnValue(true),
    };

    const cronPhase = createCronPhase(deps);
    const mgr = new ReconciliationManager([cronPhase], 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(120); // 2+ ticks
    await mgr.stop();

    // No tasks should have been created
    expect(mockStartTaskSession).not.toHaveBeenCalled();
    const tasks = sqlite.prepare(
      "SELECT id FROM tasks WHERE schedule_id = 'sched-disabled'",
    ).all();
    expect(tasks).toHaveLength(0);
  });
});
