import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies before importing ──────────────

vi.mock("@grackle-ai/core", () => ({
  listConnections: vi.fn(() => new Map()),
  removeConnection: vi.fn(),
  startTaskSession: vi.fn(),
  emit: vi.fn(),
  findFirstConnectedEnvironment: vi.fn(),
  hasCapacity: vi.fn(() => true),
  computeTaskStatus: vi.fn(() => ({ status: "not_started", latestSessionId: undefined })),
  resolveDispatchEnvironment: vi.fn(),
  resolveAncestorEnvironmentId: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@grackle-ai/plugin-core", () => ({
  createCronPhase: vi.fn((deps: unknown) => ({ name: "cron", execute: async () => {}, _deps: deps })),
  createDispatchPhase: vi.fn((deps: unknown) => ({ name: "dispatch", execute: async () => {}, _deps: deps })),
  lifecycleCleanupPhase: { name: "lifecycle-cleanup", execute: async () => {} },
  createEnvironmentReconciliationPhase: vi.fn(() => ({ name: "environment", execute: async () => {} })),
}));

vi.mock("@grackle-ai/common", () => ({
  TASK_STATUS: { NOT_STARTED: "not_started", WORKING: "working", PAUSED: "paused", COMPLETE: "complete", FAILED: "failed" },
  ROOT_TASK_ID: "system",
}));

vi.mock("@grackle-ai/database", () => ({
  scheduleStore: {
    getDueSchedules: vi.fn(() => []),
    advanceSchedule: vi.fn(),
    setScheduleEnabled: vi.fn(),
  },
  taskStore: {
    createTask: vi.fn(),
    setTaskScheduleId: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(() => []),
    areDependenciesMet: vi.fn(() => true),
  },
  workspaceStore: {
    listWorkspaces: vi.fn(() => []),
  },
  personaStore: {
    getPersona: vi.fn(),
  },
  envRegistry: {
    getEnvironment: vi.fn(),
    listEnvironments: vi.fn(() => []),
    updateEnvironmentStatus: vi.fn(),
  },
  sessionStore: {
    countActiveForEnvironment: vi.fn(() => 0),
    getActiveSessionsForTask: vi.fn(() => []),
    listSessionsForTask: vi.fn(() => []),
  },
  settingsStore: {
    getSetting: vi.fn(),
  },
  dispatchQueueStore: {
    listPending: vi.fn(() => []),
    dequeue: vi.fn(),
    enqueue: vi.fn(),
  },
  workspaceEnvironmentLinkStore: {
    getLinkedEnvironmentIds: vi.fn(() => []),
  },
}));

import { createCoreReconciliationPhases } from "./reconciliation-setup.js";
import { createCronPhase } from "@grackle-ai/plugin-core";
import { dispatchQueueStore } from "@grackle-ai/database";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createCoreReconciliationPhases", () => {
  it("returns dispatch, cron, lifecycle-cleanup, and environment phases (no orphan-reparent, no knowledge-health)", () => {
    const phases = createCoreReconciliationPhases();
    const names = phases.map((p) => p.name);
    expect(names).toEqual(["dispatch", "cron", "lifecycle-cleanup", "environment"]);
    expect(names).not.toContain("orphan-reparent");
    expect(names).not.toContain("knowledge-health");
    expect(phases).toHaveLength(4);
  });

  it("cron phase enqueueForDispatch is wired to dispatchQueueStore.enqueue", () => {
    createCoreReconciliationPhases();

    const cronDeps = (createCronPhase as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      enqueueForDispatch: (...args: unknown[]) => void;
    };
    expect(cronDeps.enqueueForDispatch).toBe(dispatchQueueStore.enqueue);
  });
});
