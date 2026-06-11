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
    taskId: null,
    agentId: null,
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
    // ── Agent-owned schedule deps (#1439) ──
    getAgent: vi.fn().mockReturnValue({ primaryPersonaId: "agent-persona-1" }),
    getRootTaskForAgent: vi.fn().mockReturnValue({ id: "root-task-1", title: "Agent Root" }),
    // ── Heartbeat branch (#1438) ──
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

const ALIVE_SESSION = {
  id: "sess-1",
  taskId: "task-A",
  status: "idle" as const,
};
const DEAD_SESSION = {
  id: "sess-1",
  taskId: "task-A",
  status: "complete" as const,
};
const TARGET_TASK = { id: "task-A", title: "Agent Root" };

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

    // Task created — createTask now takes a CreateTaskParams object (#1471)
    expect(deps.createTask).toHaveBeenCalledTimes(1);
    const taskParams = vi.mocked(deps.createTask).mock.calls[0]![0] as { id: string };
    const taskId = taskParams.id;
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
      return { id: "persona-1", name: "Test", runtime: "stub" } as ReturnType<
        CronPhaseDeps["getPersona"]
      >;
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

  // ── #1439 — Agent-owned schedule fire path ────────────────────────

  it("agent-owned: creates fire-task with agentId, kind=schedule_fire, parented on agent root", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([
      makeSchedule({ agentId: "agent-1", personaId: "" }),
    ]);
    // getAgent returns agent with primaryPersonaId
    vi.mocked(deps.getAgent).mockReturnValue({ primaryPersonaId: "agent-persona-1" });
    // getPersona resolves the inherited persona
    vi.mocked(deps.getPersona).mockReturnValue({
      id: "agent-persona-1",
      name: "AgentPersona",
      runtime: "stub",
    });
    vi.mocked(deps.getRootTaskForAgent).mockReturnValue({ id: "root-task-1", title: "Root" });

    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.createTask).toHaveBeenCalledTimes(1);
    const params = vi.mocked(deps.createTask).mock.calls[0]![0] as Record<string, unknown>;
    expect(params.agentId).toBe("agent-1");
    expect(params.kind).toBe("schedule_fire");
    expect(params.parentTaskId).toBe("root-task-1");
    expect(params.defaultPersonaId).toBe("agent-persona-1");
  });

  it("agent-owned: explicit personaId overrides agent's primary persona", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([
      makeSchedule({ agentId: "agent-1", personaId: "override-persona" }),
    ]);
    vi.mocked(deps.getPersona).mockReturnValue({
      id: "override-persona",
      name: "Override",
      runtime: "stub",
    });
    vi.mocked(deps.getRootTaskForAgent).mockReturnValue({ id: "root-task-1", title: "Root" });

    const phase = createCronPhase(deps);
    await phase.execute();

    const params = vi.mocked(deps.createTask).mock.calls[0]![0] as Record<string, unknown>;
    expect(params.defaultPersonaId).toBe("override-persona");
    // getAgent should NOT have been called — explicit personaId takes precedence
    expect(deps.getAgent).not.toHaveBeenCalled();
  });

  it("agent-owned: emits schedule.fired with agentId", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([
      makeSchedule({ agentId: "agent-1", personaId: "" }),
    ]);
    vi.mocked(deps.getAgent).mockReturnValue({ primaryPersonaId: "agent-persona-1" });
    vi.mocked(deps.getPersona).mockReturnValue({
      id: "agent-persona-1",
      name: "AgentPersona",
      runtime: "stub",
    });
    vi.mocked(deps.getRootTaskForAgent).mockReturnValue({ id: "root-task-1", title: "Root" });

    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({ scheduleId: "sched-1", agentId: "agent-1" }),
    );
  });

  it("agent-owned: disables schedule when agent root task is missing", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([
      makeSchedule({ agentId: "agent-1", personaId: "" }),
    ]);
    vi.mocked(deps.getAgent).mockReturnValue({ primaryPersonaId: "agent-persona-1" });
    vi.mocked(deps.getPersona).mockReturnValue({
      id: "agent-persona-1",
      name: "AgentPersona",
      runtime: "stub",
    });
    vi.mocked(deps.getRootTaskForAgent).mockReturnValue(undefined);

    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.setScheduleEnabled).toHaveBeenCalledWith("sched-1", false, null);
    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.enqueueForDispatch).not.toHaveBeenCalled();
  });

  it("agent-owned: skips fire and advances when no persona can be resolved", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([
      makeSchedule({ agentId: "agent-1", personaId: "" }),
    ]);
    // Agent has empty primaryPersonaId
    vi.mocked(deps.getAgent).mockReturnValue({ primaryPersonaId: "" });

    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.createTask).not.toHaveBeenCalled();
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
  });

  it("unowned schedule (no agentId) behaves exactly as before: no agentId/kind on task", async () => {
    const deps = createMockDeps();
    vi.mocked(deps.getDueSchedules).mockReturnValue([makeSchedule()]);

    const phase = createCronPhase(deps);
    await phase.execute();

    const params = vi.mocked(deps.createTask).mock.calls[0]![0] as Record<string, unknown>;
    expect(params.agentId).toBeUndefined();
    expect(params.kind).toBeUndefined();
  });

  // ── #1438 — Heartbeat branch (schedule.taskId is non-null) ────────

  it("heartbeat: skips fire when the target's latest session is alive (overrun)", async () => {
    const deps = createMockDeps();
    const sched = makeSchedule({ taskId: "task-A", description: "PING" });
    vi.mocked(deps.getDueSchedules).mockReturnValue([sched]);
    vi.mocked(deps.getTask).mockReturnValue(TARGET_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(ALIVE_SESSION);

    const phase = createCronPhase(deps);
    await phase.execute();

    // Did NOT reanimate, did NOT publish, did NOT fresh-spawn.
    expect(deps.reanimateAgent).not.toHaveBeenCalled();
    expect(deps.publishToStdin).not.toHaveBeenCalled();
    expect(deps.startTaskSession).not.toHaveBeenCalled();
    // But DID advance the schedule.
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
    // And did NOT fall through to the fresh-task path.
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it("heartbeat: reanimates the latest dead session and pipes description as stdin", async () => {
    const deps = createMockDeps();
    const sched = makeSchedule({ taskId: "task-A", description: "PING" });
    vi.mocked(deps.getDueSchedules).mockReturnValue([sched]);
    vi.mocked(deps.getTask).mockReturnValue(TARGET_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(DEAD_SESSION);

    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.reanimateAgent).toHaveBeenCalledWith("sess-1");
    expect(deps.publishToStdin).toHaveBeenCalledWith("sess-1", "PING");
    expect(deps.startTaskSession).not.toHaveBeenCalled();
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({ scheduleId: "sched-1", mode: "reanimate" }),
    );
  });

  it("heartbeat: falls back to fresh-spawn when reanimate throws", async () => {
    const deps = createMockDeps();
    const sched = makeSchedule({ taskId: "task-A", description: "PING" });
    vi.mocked(deps.getDueSchedules).mockReturnValue([sched]);
    vi.mocked(deps.getTask).mockReturnValue(TARGET_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(DEAD_SESSION);
    vi.mocked(deps.reanimateAgent).mockRejectedValue(new Error("env offline"));

    const phase = createCronPhase(deps);
    await phase.execute();

    // Reanimate was attempted but threw; fresh-spawn should pick up via rawPrompt.
    expect(deps.reanimateAgent).toHaveBeenCalledWith("sess-1");
    expect(deps.publishToStdin).not.toHaveBeenCalled();
    expect(deps.startTaskSession).toHaveBeenCalledWith(
      TARGET_TASK,
      expect.objectContaining({
        rawPrompt: "PING",
        personaId: "persona-1",
        environmentId: "env-1",
      }),
    );
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({ scheduleId: "sched-1", mode: "fresh-spawn" }),
    );
  });

  it("heartbeat: with no latest session, goes straight to fresh-spawn (no reanimate)", async () => {
    const deps = createMockDeps();
    const sched = makeSchedule({ taskId: "task-A", description: "PING" });
    vi.mocked(deps.getDueSchedules).mockReturnValue([sched]);
    vi.mocked(deps.getTask).mockReturnValue(TARGET_TASK);
    vi.mocked(deps.getLatestSessionForTask).mockReturnValue(undefined);

    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.reanimateAgent).not.toHaveBeenCalled();
    expect(deps.publishToStdin).not.toHaveBeenCalled();
    expect(deps.startTaskSession).toHaveBeenCalledWith(
      TARGET_TASK,
      expect.objectContaining({ rawPrompt: "PING" }),
    );
    expect(deps.advanceSchedule).toHaveBeenCalledTimes(1);
  });

  it("heartbeat: disables the schedule when the target task is missing", async () => {
    const deps = createMockDeps();
    const sched = makeSchedule({ taskId: "task-A", description: "PING" });
    vi.mocked(deps.getDueSchedules).mockReturnValue([sched]);
    vi.mocked(deps.getTask).mockReturnValue(undefined);

    const phase = createCronPhase(deps);
    await phase.execute();

    expect(deps.setScheduleEnabled).toHaveBeenCalledWith("sched-1", false, null);
    expect(deps.reanimateAgent).not.toHaveBeenCalled();
    expect(deps.startTaskSession).not.toHaveBeenCalled();
    expect(deps.createTask).not.toHaveBeenCalled();
  });
});
