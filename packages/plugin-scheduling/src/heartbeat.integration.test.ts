/**
 * Real-DB integration tests for the heartbeat path (#1438 hardening).
 *
 * Wires real `@grackle-ai/database` stores (in-memory SQLite via
 * `openDatabase` + `initDatabase`) into the real `createCronPhase`. Only the
 * cross-package boundaries that require external services — reanimateAgent,
 * publishToStdin, startTaskSession, env resolution — are mocked.
 *
 * Why this layer matters: the existing unit tests mock all stores, so they
 * never exercise the real schedule-store state transitions (runCount
 * increment, nextRunAt drift, FK cascade via deleteTask, etc.). This file
 * catches the bug class Copilot found on first review by walking multi-tick
 * sequences against the real persisted state.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import type { Logger } from "pino";

import {
  openDatabase,
  initDatabase,
  sqlite as _sqlite,
  scheduleStore,
  taskStore,
  sessionStore,
  envRegistry,
} from "@grackle-ai/database";
import { SESSION_STATUS } from "@grackle-ai/common";

import { createCronPhase, type CronPhaseDeps } from "./cron-phase.js";

// ── Constants ────────────────────────────────────────────────────────

const TASK_ID = "agent-root-1";
const SCHEDULE_ID = "hb-1";
const ENV_ID = "env-1";
const PERSONA_ID = "persona-1";

// ── DB lifecycle ─────────────────────────────────────────────────────

// Open the in-memory DB once at module load (mirrors
// `reanimate-agent.test.ts`'s pattern). The `_sqlite` ESM live binding
// points at the singleton; reuse it across tests.
beforeAll(() => {
  openDatabase(":memory:");
  initDatabase();
});

beforeEach(() => {
  // Reset rows between tests (cheaper than re-opening the DB).
  const sqlite = _sqlite!;
  sqlite.exec("DELETE FROM schedules");
  sqlite.exec("DELETE FROM sessions");
  sqlite.exec("DELETE FROM tasks");
  sqlite.exec("DELETE FROM environments");
  // Re-seed a connected environment so sessions can reference it (FK).
  envRegistry.addEnvironment(ENV_ID, "Test Env", "local", "{}");
  envRegistry.updateEnvironmentStatus(ENV_ID, "connected");
  vi.clearAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────────────

/** Seed a root task + heartbeat schedule. */
function seedHeartbeat(opts?: { description?: string; cadence?: string }): void {
  taskStore.insertTask({
    id: TASK_ID,
    title: "Agent Root",
    description: "",
    branch: "",
    dependsOn: [],
    parentTaskId: "",
    depth: 0,
    canDecompose: false,
    injectKnowledge: false,
    defaultPersonaId: "",
    tokenBudget: 0,
    costBudgetMillicents: 0,
    kind: "root",
  });
  scheduleStore.createSchedule(
    SCHEDULE_ID,
    "Heartbeat",
    opts?.description ?? "PING",
    opts?.cadence ?? "30s",
    PERSONA_ID,
    "", // workspaceId
    TASK_ID, // parentTaskId
    new Date("2026-03-25T09:59:00Z").toISOString(), // nextRunAt — past so it's "due"
    TASK_ID, // taskId — heartbeat discriminator
  );
}

/** Seed a session row for the heartbeat target (simulates a prior fire result). */
function seedSession(status: string): string {
  const sessionId = "sess-1";
  sessionStore.createSession(sessionId, ENV_ID, "claude-code", "PING", "sonnet", "/tmp/log");
  // createSession defaults to PENDING; nudge to the requested status.
  const sqlite = _sqlite!;
  sqlite
    .prepare("UPDATE sessions SET status = ?, runtime_session_id = ?, task_id = ? WHERE id = ?")
    .run(status, "rt-1", TASK_ID, sessionId);
  return sessionId;
}

/** Build cron-phase deps with mocked core boundaries + real stores. */
function makeDeps(overrides: Partial<CronPhaseDeps> = {}): CronPhaseDeps & {
  reanimateAgent: ReturnType<typeof vi.fn>;
  publishToStdin: ReturnType<typeof vi.fn>;
  startTaskSession: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
} {
  const reanimateAgent = vi.fn().mockResolvedValue(undefined);
  const publishToStdin = vi.fn();
  const startTaskSession = vi.fn().mockResolvedValue(undefined);
  const emit = vi.fn();
  return {
    // ── Real stores ──
    getDueSchedules: scheduleStore.getDueSchedules,
    advanceSchedule: scheduleStore.advanceSchedule,
    createTask: taskStore.createTask,
    setTaskScheduleId: taskStore.setTaskScheduleId,
    enqueueForDispatch: vi.fn(), // dispatchQueueStore not needed for heartbeat path
    setScheduleEnabled: scheduleStore.setScheduleEnabled,
    getTask: taskStore.getTask,
    getLatestSessionForTask: sessionStore.getLatestSessionForTask,
    // ── Mocked boundaries ──
    emit,
    getPersona: vi.fn().mockReturnValue({ id: PERSONA_ID, name: "Test", runtime: "stub" }),
    reanimateAgent,
    publishToStdin,
    startTaskSession,
    resolveEnvironment: vi.fn().mockReturnValue(ENV_ID),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Pick<Logger, "debug" | "info" | "warn" | "error">,
    ...overrides,
  } as ReturnType<typeof makeDeps>;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("heartbeat integration (real stores)", () => {
  it("two consecutive ticks → first fresh-spawns, second reanimates, runCount goes 0→1→2 in the real DB", async () => {
    seedHeartbeat();
    const deps = makeDeps();
    const phase = createCronPhase(deps);

    // Tick 1: no session yet → cron uses the fresh-spawn fallback (mocked).
    await phase.execute();
    expect(deps.startTaskSession).toHaveBeenCalledTimes(1);
    expect(deps.reanimateAgent).not.toHaveBeenCalled();

    // Real DB state: runCount went 0 → 1, nextRunAt advanced past tick-1.
    const afterTick1 = scheduleStore.getSchedule(SCHEDULE_ID)!;
    expect(afterTick1.runCount).toBe(1);
    expect(afterTick1.lastRunAt).toBeTruthy();
    expect(afterTick1.nextRunAt).toBeTruthy();

    // Simulate that the spawn created and finished a session (mocked startTaskSession
    // didn't actually persist anything). Manually insert a STOPPED session row.
    seedSession(SESSION_STATUS.STOPPED);

    // Make the schedule due again (rewind nextRunAt into the past).
    const sqlite = _sqlite!;
    sqlite
      .prepare("UPDATE schedules SET next_run_at = ? WHERE id = ?")
      .run("2026-03-25T09:59:30Z", SCHEDULE_ID);

    // Tick 2: latest session is STOPPED → reanimate path fires.
    await phase.execute();
    expect(deps.reanimateAgent).toHaveBeenCalledWith("sess-1");
    expect(deps.publishToStdin).toHaveBeenCalledWith("sess-1", "PING");

    // Real DB state: runCount=2, lastRunAt updated to the second fire.
    const afterTick2 = scheduleStore.getSchedule(SCHEDULE_ID)!;
    expect(afterTick2.runCount).toBe(2);
    // (Don't assert nextRunAt differs — within the same ms both ticks anchor
    // to the same computed value; the runCount + lastRunAt are the canonical
    // proof that two distinct fires happened.)
  });

  it("ALIVE session (RUNNING/IDLE/PENDING) → skip + advance, no reanimate, no new session row", async () => {
    seedHeartbeat();
    seedSession(SESSION_STATUS.IDLE);
    const deps = makeDeps();
    await createCronPhase(deps).execute();

    expect(deps.reanimateAgent).not.toHaveBeenCalled();
    expect(deps.startTaskSession).not.toHaveBeenCalled();
    // Still advanced (overrun isn't a fire-failure, just a skip).
    const after = scheduleStore.getSchedule(SCHEDULE_ID)!;
    expect(after.runCount).toBe(1);
    // Only the one seeded session row exists.
    expect(sessionStore.listSessions().length).toBe(1);
  });

  it("clear via deleteSchedule between ticks → next tick is a no-op", async () => {
    seedHeartbeat();
    const deps = makeDeps();
    const phase = createCronPhase(deps);

    await phase.execute();
    expect(deps.startTaskSession).toHaveBeenCalledTimes(1);

    // Operator clears the heartbeat — the schedule row goes away.
    scheduleStore.deleteSchedule(SCHEDULE_ID);
    expect(scheduleStore.getSchedule(SCHEDULE_ID)).toBeUndefined();

    // Next tick: nothing due, nothing fires.
    await phase.execute();
    expect(deps.startTaskSession).toHaveBeenCalledTimes(1); // still 1
  });

  it("pause survives a poll: setScheduleEnabled(false, null) → cron-phase sees nothing due", async () => {
    seedHeartbeat();
    const deps = makeDeps();
    const phase = createCronPhase(deps);

    await phase.execute();
    expect(deps.startTaskSession).toHaveBeenCalledTimes(1);

    // Pause via the store API (matches what setAgentHeartbeat({enabled:false}) does).
    scheduleStore.setScheduleEnabled(SCHEDULE_ID, false, null);
    const paused = scheduleStore.getSchedule(SCHEDULE_ID)!;
    expect(paused.enabled).toBe(false);
    expect(paused.nextRunAt).toBeNull();

    // Tick again — `getDueSchedules` filters by `enabled=1`, so nothing fires.
    await phase.execute();
    expect(deps.startTaskSession).toHaveBeenCalledTimes(1); // unchanged
    expect(deps.reanimateAgent).not.toHaveBeenCalled();
  });

  it("resume after pause: setScheduleEnabled(true, <future>) → next tick fires when due", async () => {
    seedHeartbeat();
    scheduleStore.setScheduleEnabled(SCHEDULE_ID, false, null);

    // Resume with a past nextRunAt so the next tick picks it up.
    scheduleStore.setScheduleEnabled(SCHEDULE_ID, true, "2026-03-25T09:59:00Z");

    const deps = makeDeps();
    await createCronPhase(deps).execute();
    expect(deps.startTaskSession).toHaveBeenCalledTimes(1);
    const after = scheduleStore.getSchedule(SCHEDULE_ID)!;
    expect(after.runCount).toBe(1);
  });

  it("FK cascade: real taskStore.deleteTask removes the heartbeat schedule (#1438)", async () => {
    seedHeartbeat();
    // Confirm the row exists and references the task.
    expect(scheduleStore.getHeartbeatForTask(TASK_ID)?.id).toBe(SCHEDULE_ID);

    // Delete the root task — the deleteTask cascade should remove the
    // referencing schedule row first, then the task itself. Without the
    // cascade, foreign_keys=ON would throw SQLITE_CONSTRAINT here.
    taskStore.deleteTask(TASK_ID);

    expect(taskStore.getTask(TASK_ID)).toBeUndefined();
    expect(scheduleStore.getHeartbeatForTask(TASK_ID)).toBeUndefined();
    expect(scheduleStore.getSchedule(SCHEDULE_ID)).toBeUndefined();
  });

  it("reanimate throws → fresh-spawn fallback uses rawPrompt = schedule.description, runCount still advances", async () => {
    seedHeartbeat({ description: "BEAT" });
    seedSession(SESSION_STATUS.STOPPED);

    const deps = makeDeps();
    deps.reanimateAgent.mockRejectedValueOnce(new Error("env offline"));

    await createCronPhase(deps).execute();

    expect(deps.reanimateAgent).toHaveBeenCalledTimes(1);
    expect(deps.startTaskSession).toHaveBeenCalledTimes(1);
    const spawnArgs = deps.startTaskSession.mock.calls[0]![1] as {
      rawPrompt: string;
      personaId: string;
      environmentId: string;
    };
    expect(spawnArgs.rawPrompt).toBe("BEAT");
    expect(spawnArgs.personaId).toBe(PERSONA_ID);
    expect(spawnArgs.environmentId).toBe(ENV_ID);

    // Schedule advanced + emit fired with mode=fresh-spawn.
    const after = scheduleStore.getSchedule(SCHEDULE_ID)!;
    expect(after.runCount).toBe(1);
    expect(deps.emit).toHaveBeenCalledWith(
      "schedule.fired",
      expect.objectContaining({ mode: "fresh-spawn" }),
    );
  });

  it("missing target task → setScheduleEnabled(false, null), schedule paused with nextRunAt cleared", async () => {
    seedHeartbeat();
    // Simulate the legacy / corrupted state where the task is gone but the
    // heartbeat still references it. We have to disable FK enforcement
    // briefly because the cascade in `taskStore.deleteTask` would clean up
    // the schedule first (defeating the test). Real production state could
    // reach this via a partial migration or out-of-band DB edit.
    const sqlite = _sqlite!;
    sqlite.pragma("foreign_keys = OFF");
    try {
      sqlite.prepare("DELETE FROM tasks WHERE id = ?").run(TASK_ID);
    } finally {
      sqlite.pragma("foreign_keys = ON");
    }

    const deps = makeDeps();
    await createCronPhase(deps).execute();

    const after = scheduleStore.getSchedule(SCHEDULE_ID)!;
    expect(after.enabled).toBe(false);
    expect(after.nextRunAt).toBeNull();
    expect(deps.reanimateAgent).not.toHaveBeenCalled();
    expect(deps.startTaskSession).not.toHaveBeenCalled();
  });
});
