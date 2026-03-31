import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies before importing ──────────────

vi.mock("@grackle-ai/core", () => ({
  listConnections: vi.fn(() => new Map()),
  removeConnection: vi.fn(),
  createKnowledgeHealthPhase: vi.fn(() => ({ name: "knowledge-health", execute: async () => {} })),
  startTaskSession: vi.fn(),
  emit: vi.fn(),
  findFirstConnectedEnvironment: vi.fn(),
  hasCapacity: vi.fn(() => true),
  computeTaskStatus: vi.fn(() => ({ status: "not_started", latestSessionId: undefined })),
  resolveDispatchEnvironment: vi.fn(),
  resolveAncestorEnvironmentId: vi.fn(),
  isKnowledgeEnabled: vi.fn(() => false),
  neo4jHealthCheck: vi.fn(),
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
import { isKnowledgeEnabled, createKnowledgeHealthPhase, neo4jHealthCheck } from "@grackle-ai/core";
import { createCronPhase } from "@grackle-ai/plugin-core";
import { dispatchQueueStore } from "@grackle-ai/database";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createCoreReconciliationPhases", () => {
  it("returns dispatch, cron, lifecycle-cleanup, and environment phases (no orphan-reparent)", () => {
    const phases = createCoreReconciliationPhases();
    const names = phases.map((p) => p.name);
    expect(names).toEqual(["dispatch", "cron", "lifecycle-cleanup", "environment"]);
    expect(names).not.toContain("orphan-reparent");
  });

  it("includes knowledge-health phase when knowledge is enabled", () => {
    (isKnowledgeEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const phases = createCoreReconciliationPhases();
    const names = phases.map((p) => p.name);
    expect(names).toContain("knowledge-health");
    expect(phases).toHaveLength(5);
  });

  it("omits knowledge-health phase when knowledge is disabled", () => {
    (isKnowledgeEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const phases = createCoreReconciliationPhases();
    const names = phases.map((p) => p.name);
    expect(names).not.toContain("knowledge-health");
  });

  it("passes neo4jHealthCheck to knowledge health phase", () => {
    (isKnowledgeEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    createCoreReconciliationPhases();
    expect(createKnowledgeHealthPhase).toHaveBeenCalledWith({ healthCheck: neo4jHealthCheck });
  });

  it("cron phase enqueueForDispatch is wired to dispatchQueueStore.enqueue", () => {
    createCoreReconciliationPhases();

    const cronDeps = (createCronPhase as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      enqueueForDispatch: (...args: unknown[]) => void;
    };
    expect(cronDeps.enqueueForDispatch).toBe(dispatchQueueStore.enqueue);
  });
});
