/**
 * Real-DB integration tests for the agent-owned schedule fire path (#1439).
 *
 * Mirrors heartbeat.integration.test.ts: real stores via openDatabase(":memory:")
 * + initDatabase(), real createCronPhase, only external boundaries mocked.
 *
 * Why this layer matters: unit tests mock all stores, so they never exercise
 * real store wiring — e.g. agentStore.getAgent() returning the seeded agent,
 * taskStore.getRootTaskForAgent() returning the seeded root task, or the FK
 * cascade through deleteAgent() -> detachSchedulesForAgent().
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { Logger } from "pino";

import type { CreateTaskParams } from "@grackle-ai/core";
import {
  openDatabase,
  initDatabase,
  sqlite as _sqlite,
  agentStore,
  scheduleStore,
  taskStore,
  envRegistry,
} from "@grackle-ai/database";

import { createCronPhase, type CronPhaseDeps } from "./cron-phase.js";

// ── Constants ────────────────────────────────────────────────────────────────

const AGENT_ID = "agent-1";
const ROOT_TASK_ID = "root-1";
const SCHEDULE_ID = "cron-1";
const PERSONA_ID = "persona-1";
const ENV_ID = "env-1";

// ── DB lifecycle ─────────────────────────────────────────────────────────────

beforeAll(() => {
  openDatabase(":memory:");
  initDatabase();
});

beforeEach(() => {
  const sqlite = _sqlite!;
  sqlite.exec("DELETE FROM schedules");
  sqlite.exec("DELETE FROM sessions");
  sqlite.exec("DELETE FROM tasks");
  sqlite.exec("DELETE FROM agents");
  sqlite.exec("DELETE FROM environments");
  envRegistry.addEnvironment(ENV_ID, "Test Env", "local", "{}");
  envRegistry.updateEnvironmentStatus(ENV_ID, "connected");
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedAgentWithRoot(primaryPersonaId: string = PERSONA_ID): void {
  agentStore.createAgent(AGENT_ID, "PM Bot", "", primaryPersonaId, ENV_ID);
  taskStore.insertTask({
    id: ROOT_TASK_ID,
    title: "PM Bot Root",
    description: "",
    branch: "",
    dependsOn: [],
    parentTaskId: "",
    depth: 0,
    canDecompose: true,
    injectKnowledge: false,
    defaultPersonaId: primaryPersonaId,
    tokenBudget: 0,
    costBudgetMillicents: 0,
    kind: "root",
    agentId: AGENT_ID,
  });
}

function seedCronSchedule(
  personaId: string = "",
  nextRunAt: string = "2026-01-01T00:00:00Z",
): void {
  scheduleStore.createSchedule(
    SCHEDULE_ID,
    "Nightly Scan",
    "description",
    "30s",
    personaId,
    "",
    "",
    nextRunAt,
    null,
    AGENT_ID,
  );
}

/**
 * Thin createTask shim for integration tests — uses taskStore.insertTask directly
 * to avoid getDatabaseStores() initialization required by taskService.createTask.
 * The business-logic layer (branch computation, depth limits) is tested separately
 * in @grackle-ai/core; here we exercise only the store wiring and cron-phase logic.
 */
function testCreateTask(params: CreateTaskParams): void {
  const parentRow = params.parentTaskId ? taskStore.getTask(params.parentTaskId) : undefined;
  taskStore.insertTask({
    id: params.id!,
    title: params.title,
    description: params.description ?? "",
    branch: parentRow
      ? `${parentRow.branch}/${params.title.toLowerCase().replace(/\s+/g, "-")}`
      : params.title.toLowerCase().replace(/\s+/g, "-"),
    dependsOn: params.dependsOn ?? [],
    parentTaskId: params.parentTaskId ?? "",
    depth: parentRow ? parentRow.depth + 1 : 0,
    canDecompose: params.canDecompose ?? false,
    injectKnowledge: false,
    defaultPersonaId: params.defaultPersonaId ?? "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
    agentId: params.agentId,
    kind: params.kind,
  });
}

function makeDeps(overrides: Partial<CronPhaseDeps> = {}): CronPhaseDeps {
  return {
    getDueSchedules: scheduleStore.getDueSchedules,
    advanceSchedule: scheduleStore.advanceSchedule,
    createTask: testCreateTask,
    setTaskScheduleId: taskStore.setTaskScheduleId,
    enqueueForDispatch: vi.fn(),
    setScheduleEnabled: scheduleStore.setScheduleEnabled,
    emit: vi.fn(),
    getPersona: vi.fn().mockReturnValue({ id: PERSONA_ID, name: "Test", runtime: "stub" }),
    getAgent: agentStore.getAgent,
    getRootTaskForAgent: (id: string) => {
      const row = taskStore.getRootTaskForAgent(id);
      if (!row) {
        return undefined;
      }
      return { id: row.id, title: row.title };
    },
    getTask: vi.fn(),
    getLatestSessionForTask: vi.fn(),
    reanimateAgent: vi.fn().mockResolvedValue(undefined),
    publishToStdin: vi.fn(),
    startTaskSession: vi.fn().mockResolvedValue(undefined),
    resolveEnvironment: vi.fn().mockReturnValue(ENV_ID),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Pick<Logger, "debug" | "info" | "warn" | "error">,
    ...overrides,
  };
}

// ── Tests: agent-owned schedule fire path ────────────────────────────────────

describe("agent-owned schedule integration (real stores)", () => {
  it("fire-task is created with agentId, kind=schedule_fire, and parent=agent root", async () => {
    seedAgentWithRoot(PERSONA_ID);
    seedCronSchedule("", "2026-01-01T00:00:00Z");

    const deps = makeDeps();
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:05Z") });
    try {
      const phase = createCronPhase(deps);
      await phase.execute();
    } finally {
      vi.useRealTimers();
    }

    // A fire-task was created under the agent root.
    const allTasks = taskStore.getTasksForAgent(AGENT_ID);
    const fireTask = allTasks.find((t) => t.kind === "schedule_fire");
    expect(fireTask).toBeDefined();
    expect(fireTask!.agentId).toBe(AGENT_ID);
    expect(fireTask!.parentTaskId).toBe(ROOT_TASK_ID);

    // Schedule runCount and nextRunAt advanced in the real DB.
    const sched = scheduleStore.getSchedule(SCHEDULE_ID)!;
    expect(sched.runCount).toBe(1);
    expect(sched.lastRunAt).toBeTruthy();
    expect(sched.nextRunAt).not.toBe("2026-01-01T00:00:00Z");
  });

  it("persona is inherited from agent.primaryPersonaId when schedule personaId is empty", async () => {
    seedAgentWithRoot("inherited-persona");
    seedCronSchedule("", "2026-01-01T00:00:00Z");

    const deps = makeDeps({
      getPersona: vi.fn().mockImplementation((id: string) => {
        if (id === "inherited-persona") {
          return { id: "inherited-persona", name: "Inherited", runtime: "stub" };
        }
        return undefined;
      }),
    });
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:05Z") });
    try {
      const phase = createCronPhase(deps);
      await phase.execute();
    } finally {
      vi.useRealTimers();
    }

    const enqueue = vi.mocked(deps.enqueueForDispatch);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0]).toMatchObject({ personaId: "inherited-persona" });
  });

  it("disables schedule when agent has no root task in the real DB", async () => {
    // Create agent but no root task.
    agentStore.createAgent(AGENT_ID, "PM Bot", "", PERSONA_ID, ENV_ID);
    seedCronSchedule("", "2026-01-01T00:00:00Z");

    const deps = makeDeps();
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:05Z") });
    try {
      const phase = createCronPhase(deps);
      await phase.execute();
    } finally {
      vi.useRealTimers();
    }

    // Schedule must be disabled in the real DB.
    const sched = scheduleStore.getSchedule(SCHEDULE_ID)!;
    expect(sched.enabled).toBe(false);
    expect(sched.nextRunAt).toBeNull();
    // No fire-task created.
    expect(taskStore.getTasksForAgent(AGENT_ID)).toHaveLength(0);
  });
});

// ── Tests: deleteAgent -> detachSchedulesForAgent cascade ────────────────────

describe("deleteAgent cascade (real stores)", () => {
  it("standalone schedule with explicit personaId survives enabled with agentId=null", () => {
    seedAgentWithRoot(PERSONA_ID);
    scheduleStore.createSchedule(
      "cron-explicit",
      "Explicit Persona",
      "",
      "5m",
      PERSONA_ID,
      "",
      "",
      "2099-01-01T00:00:00Z",
      null,
      AGENT_ID,
    );

    scheduleStore.detachSchedulesForAgent(AGENT_ID);

    const s = scheduleStore.getSchedule("cron-explicit")!;
    expect(s).toBeDefined();
    expect(s.agentId).toBeNull();
    expect(s.enabled).toBe(true);
    expect(s.nextRunAt).toBe("2099-01-01T00:00:00Z");
  });

  it("standalone schedule with inherited persona (personaId='') is disabled after detach", () => {
    seedAgentWithRoot(PERSONA_ID);
    scheduleStore.createSchedule(
      "cron-inherited",
      "Inherited Persona",
      "",
      "5m",
      "",
      "",
      "",
      "2099-01-01T00:00:00Z",
      null,
      AGENT_ID,
    );

    scheduleStore.detachSchedulesForAgent(AGENT_ID);

    const s = scheduleStore.getSchedule("cron-inherited")!;
    expect(s).toBeDefined();
    expect(s.agentId).toBeNull();
    expect(s.enabled).toBe(false);
    expect(s.nextRunAt).toBeNull();
  });

  it("heartbeat schedule (taskId non-null) is deleted on detach", () => {
    seedAgentWithRoot(PERSONA_ID);
    scheduleStore.createSchedule(
      "hb-agent",
      "Heartbeat",
      "",
      "30s",
      PERSONA_ID,
      "",
      "",
      "2099-01-01T00:00:00Z",
      ROOT_TASK_ID,
      AGENT_ID,
    );

    scheduleStore.detachSchedulesForAgent(AGENT_ID);

    expect(scheduleStore.getSchedule("hb-agent")).toBeUndefined();
  });
});
