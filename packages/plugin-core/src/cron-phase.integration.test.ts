import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
  };
});

// Use real in-memory database
import { openDatabase, initDatabase, seedDatabase, sqlite as _sqlite, taskStore, scheduleStore, personaStore, dispatchQueueStore } from "@grackle-ai/database";
openDatabase(":memory:");
initDatabase();
seedDatabase(_sqlite!);
const sqlite = _sqlite!;

import { createCronPhase, type CronPhaseDeps } from "./cron-phase.js";
import { ReconciliationManager, emit } from "@grackle-ai/core";

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
    sqlite.exec("DELETE FROM dispatch_queue");
  });

  it("full flow: schedule fires, task created, enqueued for dispatch, schedule advanced", async () => {
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

    const deps: CronPhaseDeps = {
      getDueSchedules: scheduleStore.getDueSchedules,
      advanceSchedule: scheduleStore.advanceSchedule,
      createTask: taskStore.createTask,
      setTaskScheduleId: taskStore.setTaskScheduleId,
      enqueueForDispatch: dispatchQueueStore.enqueue,
      emit: vi.mocked(emit),
      getPersona: personaStore.getPersona,
      setScheduleEnabled: scheduleStore.setScheduleEnabled,
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
    expect(tasks[0]!.title).toContain("Integration Test @");
    expect(tasks[0]!.schedule_id).toBe("sched-int-1");
    expect(tasks[0]!.default_persona_id).toBe("stub-persona");

    // Verify dispatch queue row was written to real DB
    const queueRows = dispatchQueueStore.listPending();
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0]!.taskId).toBe(tasks[0]!.id);
    expect(queueRows[0]!.personaId).toBe("stub-persona");

    // Verify schedule was advanced in DB
    const after = scheduleStore.getSchedule("sched-int-1");
    expect(after!.runCount).toBe(1);
    expect(after!.lastRunAt).toBeTruthy();
    expect(after!.nextRunAt).not.toBe(nextRunAt);

    // Verify schedule.fired event was emitted
    expect(vi.mocked(emit)).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({
        scheduleId: "sched-int-1",
        taskId: tasks[0]!.id,
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

    const deps: CronPhaseDeps = {
      getDueSchedules: scheduleStore.getDueSchedules,
      advanceSchedule: scheduleStore.advanceSchedule,
      createTask: taskStore.createTask,
      setTaskScheduleId: taskStore.setTaskScheduleId,
      enqueueForDispatch: dispatchQueueStore.enqueue,
      emit: vi.mocked(emit),
      getPersona: personaStore.getPersona,
      setScheduleEnabled: scheduleStore.setScheduleEnabled,
    };

    const cronPhase = createCronPhase(deps);
    const mgr = new ReconciliationManager([cronPhase], 50);
    mgr.start();
    await vi.advanceTimersByTimeAsync(120);
    await mgr.stop();

    expect(dispatchQueueStore.listPending()).toHaveLength(0);
    const tasks = sqlite.prepare(
      "SELECT id FROM tasks WHERE schedule_id = 'sched-disabled'",
    ).all();
    expect(tasks).toHaveLength(0);
  });
});
