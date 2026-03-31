import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "pino";

import { createCronPhase, type CronPhaseDeps } from "./cron-phase.js";
import type { ScheduleRow } from "@grackle-ai/database";

function makeSchedule(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: "sched-1",
    title: "Test Schedule",
    description: "",
    scheduleExpression: "30s",
    personaId: "persona-1",
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
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Pick<Logger, "debug" | "info" | "warn" | "error">,
  };
}

describe("createCronPhase", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-25T10:00:05Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("is a no-op when no schedules are due", async () => {
    const deps = createMockDeps();
    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.enqueueForDispatch).not.toHaveBeenCalled();
  });

  it("fires a due schedule — creates task, enqueues for dispatch, advances", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([makeSchedule()]);

    const phase = createCronPhase(deps);
    await phase.execute();

    // Task created
    expect(deps.createTask).toHaveBeenCalledTimes(1);
    const taskId = vi.mocked(deps.createTask).mock.calls[0]![0];
    expect(taskId).toBeTruthy();

    // scheduleId FK set
    expect(deps.setTaskScheduleId).toHaveBeenCalledWith(taskId, "sched-1");

    // Enqueued for dispatch
    expect(deps.enqueueForDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ taskId, personaId: "persona-1" }),
    );

    // Schedule advanced
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
  });

  it("enqueues without environmentId so dispatch resolves via workspace pool", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([makeSchedule()]);

    const phase = createCronPhase(deps);
    await phase.execute();

    const call = vi.mocked(deps.enqueueForDispatch).mock.calls[0]![0];
    expect(call.personaId).toBe("persona-1");
    expect(call).not.toHaveProperty("environmentId");
  });

  it("emits schedule.fired event on successful fire", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([makeSchedule()]);

    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({ scheduleId: "sched-1" }),
    );
  });

  it("skips fire when persona not found but still advances", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([makeSchedule({ personaId: "missing" })]);
    vi.mocked(deps.getPersona).mockReturnValue(undefined);

    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.enqueueForDispatch).not.toHaveBeenCalled();
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
  });

  it("continues firing other schedules when one fails", async () => {
    const deps = createMockDeps();
    const s1 = makeSchedule({ id: "s1", personaId: "missing-persona" });
    const s2 = makeSchedule({ id: "s2" });
    vi.mocked(deps.getDueSchedules).mockReturnValue([s1, s2]);
    vi.mocked(deps.getPersona).mockImplementation((id: string) => {
      if (id === "missing-persona") {
        return undefined;
      }
      return { id: "persona-1", name: "Test", runtime: "stub" } as ReturnType<CronPhaseDeps["getPersona"]>;
    });

    const phase = createCronPhase(deps);
    await phase.execute();

    // s1 failed (no persona) but s2 should still fire
    expect(deps.createTask).toHaveBeenCalledTimes(1);
    // Both schedules advanced
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(2);
  });

  it("disables schedule when expression is invalid", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([
      makeSchedule({ scheduleExpression: "invalid!!!" }),
    ]);

    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.setScheduleEnabled).toHaveBeenCalledWith("sched-1", false, null);
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it("has name 'cron'", () => {
    const deps = createMockDeps();
    const phase = createCronPhase(deps);
    expect(phase.name).toBe("cron");
  });
});
