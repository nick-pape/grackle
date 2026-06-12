import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginContext } from "@grackle-ai/plugin-sdk";
import type { Logger } from "pino";

// Mock database stores (scheduling plugin reads via getDatabaseStores())
vi.mock("@grackle-ai/database", () => {
  const scheduleStore = {
    getDueSchedules: vi.fn(),
    advanceSchedule: vi.fn(),
    setScheduleEnabled: vi.fn(),
  };
  const taskStore = {
    setTaskScheduleId: vi.fn(),
    getTask: vi.fn(),
    getRootTaskForAgent: vi.fn(),
  };
  const personaStore = { getPersona: vi.fn() };
  const agentStore = { getAgent: vi.fn() };
  const sessionStore = { getLatestSessionForTask: vi.fn() };
  const dispatchQueueStore = { enqueue: vi.fn() };
  const stores = {
    scheduleStore,
    taskStore,
    personaStore,
    agentStore,
    sessionStore,
    dispatchQueueStore,
  };
  return {
    scheduleStore,
    taskStore,
    personaStore,
    agentStore,
    sessionStore,
    dispatchQueueStore,
    getDatabaseStores: () => stores,
  };
});

// The heartbeat branch (#1438) reads core helpers (reanimate, stdin, spawn,
// env resolver). Mock the surface to avoid pulling in the real event-bus,
// which expects more of @grackle-ai/common than we mock here.
vi.mock("@grackle-ai/core", () => ({
  findFirstConnectedEnvironment: vi.fn(),
  reanimateAgent: vi.fn(),
  publishToStdin: vi.fn(),
  startTaskSession: vi.fn(),
  toTaskModel: vi.fn((row: unknown) => row),
  // taskService.createTask is accessed during reconciliationPhases() wiring (#1471)
  taskService: { createTask: vi.fn() },
}));

vi.mock("@grackle-ai/common", () => ({
  grackle: { GrackleScheduling: { typeName: "grackle.GrackleScheduling" } },
  SESSION_STATUS: { PENDING: "pending", RUNNING: "running", IDLE: "idle", STOPPED: "stopped" },
  ROOT_TASK_ID: "ROOT",
  serverTimestamp: vi.fn(() => "2026-01-01T00:00:00Z"),
  computeNextRunAt: vi.fn(() => "2026-01-01T00:00:30Z"),
  createPinoLogger: vi.fn(() => ({
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    bindings: vi.fn().mockReturnValue({}),
    level: "info",
    isLevelEnabled: vi.fn().mockReturnValue(false),
  })),
}));

import { agentStore, scheduleStore, taskStore, personaStore } from "@grackle-ai/database";
import { findFirstConnectedEnvironment } from "@grackle-ai/core";
import { createSchedulingPlugin, resolveEnvironmentForHeartbeat } from "./scheduling-plugin.js";
import type { TaskRow, ScheduleRow } from "@grackle-ai/database";

/** Create a minimal mock PluginContext for testing. */
function createMockContext(): PluginContext {
  return {
    subscribe: vi.fn(() => vi.fn()),
    emit: vi.fn() as PluginContext["emit"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger,
    config: {
      grpcPort: 7434,
      webPort: 3000,
      mcpPort: 7435,
      powerlinePort: 7433,
      host: "127.0.0.1",
      grackleHome: "/tmp/grackle",
      apiKey: "test-key",
      skipRootAutostart: true,
    },
  };
}

describe("createSchedulingPlugin", () => {
  it("returns name 'scheduling'", () => {
    const plugin = createSchedulingPlugin();
    expect(plugin.name).toBe("scheduling");
  });

  it("declares dependency on 'core'", () => {
    const plugin = createSchedulingPlugin();
    expect(plugin.dependencies).toEqual(["core"]);
  });

  it("grpcHandlers returns 1 ServiceRegistration on grackle.GrackleScheduling", () => {
    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const registrations = plugin.grpcHandlers!(ctx);

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.service).toHaveProperty("typeName", "grackle.GrackleScheduling");
  });

  it("grpcHandlers registration includes all 5 schedule methods", () => {
    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const registrations = plugin.grpcHandlers!(ctx);
    const handlers = registrations[0]!.handlers;

    expect(handlers).toHaveProperty("createSchedule");
    expect(handlers).toHaveProperty("listSchedules");
    expect(handlers).toHaveProperty("getSchedule");
    expect(handlers).toHaveProperty("updateSchedule");
    expect(handlers).toHaveProperty("deleteSchedule");
  });

  it("reconciliationPhases returns exactly 1 phase", () => {
    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const phases = plugin.reconciliationPhases!(ctx);
    expect(phases).toHaveLength(1);
  });

  it("reconciliationPhases includes 'cron' phase", () => {
    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const phases = plugin.reconciliationPhases!(ctx);
    expect(phases[0]!.name).toBe("cron");
  });

  it("has no eventSubscribers", () => {
    const plugin = createSchedulingPlugin();
    expect(plugin.eventSubscribers).toBeUndefined();
  });

  it("has no mcpTools", () => {
    const plugin = createSchedulingPlugin();
    expect(plugin.mcpTools).toBeUndefined();
  });
});

describe("resolveEnvironmentForHeartbeat (#1438)", () => {
  const taskWithAgent = { id: "task-A", agentId: "agent-1" } as TaskRow;
  const taskNoAgent = { id: "task-B", agentId: "" } as TaskRow;

  it("returns the agent's home environment when task.agentId is set and the agent has one", () => {
    vi.mocked(agentStore.getAgent).mockReturnValue({
      id: "agent-1",
      environmentId: "env-agent",
    } as ReturnType<typeof agentStore.getAgent>);
    expect(resolveEnvironmentForHeartbeat(taskWithAgent)).toBe("env-agent");
    expect(findFirstConnectedEnvironment).not.toHaveBeenCalled();
  });

  it("falls back to first-connected when the task has no agentId", () => {
    vi.mocked(findFirstConnectedEnvironment).mockReturnValue({
      id: "env-first",
    } as ReturnType<typeof findFirstConnectedEnvironment>);
    expect(resolveEnvironmentForHeartbeat(taskNoAgent)).toBe("env-first");
  });

  it("falls back to first-connected when the agent has no home environment", () => {
    vi.mocked(agentStore.getAgent).mockReturnValue({
      id: "agent-1",
      environmentId: "",
    } as ReturnType<typeof agentStore.getAgent>);
    vi.mocked(findFirstConnectedEnvironment).mockReturnValue({
      id: "env-fallback",
    } as ReturnType<typeof findFirstConnectedEnvironment>);
    expect(resolveEnvironmentForHeartbeat(taskWithAgent)).toBe("env-fallback");
  });

  it("returns undefined when no environment is connected and no agent is set", () => {
    vi.mocked(findFirstConnectedEnvironment).mockReturnValue(undefined);
    expect(resolveEnvironmentForHeartbeat(taskNoAgent)).toBeUndefined();
  });
});

describe("cron phase inline dep arrows (#1439)", () => {
  /** Minimal valid schedule row with no heartbeat target and no agent. */
  function makeScheduleRow(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
    return {
      id: "sched-1",
      title: "Test",
      description: "desc",
      scheduleExpression: "30s",
      personaId: "",
      agentId: null,
      taskId: null,
      workspaceId: "",
      parentTaskId: "",
      enabled: 1 as unknown as boolean,
      lastRunAt: null,
      nextRunAt: "2026-01-01T00:00:00Z",
      runCount: 0,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(scheduleStore.getDueSchedules).mockReturnValue([]);
  });

  it("getRootTaskForAgent arrow delegates to taskStore for agent-owned schedule fire", async () => {
    vi.mocked(scheduleStore.getDueSchedules).mockReturnValue([
      makeScheduleRow({ agentId: "agent-1", personaId: "" }),
    ]);
    vi.mocked(agentStore.getAgent).mockReturnValue({
      id: "agent-1",
      primaryPersonaId: "p-1",
    } as ReturnType<typeof agentStore.getAgent>);
    vi.mocked(personaStore.getPersona).mockReturnValue({
      id: "p-1",
      name: "Alice",
      runtime: "stub",
    } as ReturnType<typeof personaStore.getPersona>);
    // Returning undefined simulates a missing agent root → schedule gets disabled.
    vi.mocked(taskStore.getRootTaskForAgent).mockReturnValue(undefined);

    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const phases = plugin.reconciliationPhases!(ctx);
    await phases[0]!.execute();

    expect(taskStore.getRootTaskForAgent).toHaveBeenCalledWith("agent-1");
    expect(scheduleStore.setScheduleEnabled).toHaveBeenCalledWith("sched-1", false, null);
  });

  it("getTask arrow delegates to taskStore for heartbeat schedule fire", async () => {
    vi.mocked(scheduleStore.getDueSchedules).mockReturnValue([
      makeScheduleRow({ taskId: "task-1", personaId: "p-1" }),
    ]);
    // Returning undefined simulates a missing heartbeat target → schedule gets disabled.
    vi.mocked(taskStore.getTask).mockReturnValue(undefined);

    const plugin = createSchedulingPlugin();
    const ctx = createMockContext();
    const phases = plugin.reconciliationPhases!(ctx);
    await phases[0]!.execute();

    expect(taskStore.getTask).toHaveBeenCalledWith("task-1");
    expect(scheduleStore.setScheduleEnabled).toHaveBeenCalledWith("sched-1", false, null);
  });
});
