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
  interruptChildSession: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@grackle-ai/plugin-core", () => ({
  createDispatchPhase: vi.fn((deps: unknown) => ({
    name: "dispatch",
    execute: async () => {},
    _deps: deps,
  })),
  lifecycleCleanupPhase: { name: "lifecycle-cleanup", execute: async () => {} },
  createEnvironmentReconciliationPhase: vi.fn(() => ({
    name: "environment-status",
    execute: async () => {},
  })),
  createSubagentReconciliationPhase: vi.fn(() => ({
    name: "subagent-reconciliation",
    execute: async () => {},
  })),
}));

vi.mock("@grackle-ai/common", () => ({
  TASK_STATUS: {
    NOT_STARTED: "not_started",
    WORKING: "working",
    PAUSED: "paused",
    COMPLETE: "complete",
    FAILED: "failed",
  },
  ROOT_TASK_ID: "system",
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

vi.mock("@grackle-ai/database", () => {
  const taskStore = {
    createTask: vi.fn(),
    setTaskScheduleId: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(() => []),
    areDependenciesMet: vi.fn(() => true),
    reparentTask: vi.fn(),
  };
  const workspaceStore = {
    listWorkspaces: vi.fn(() => []),
    getWorkspace: vi.fn(),
  };
  const personaStore = { getPersona: vi.fn() };
  const envRegistry = {
    getEnvironment: vi.fn(),
    listEnvironments: vi.fn(() => []),
    updateEnvironmentStatus: vi.fn(),
  };
  const sessionStore = {
    countActiveForEnvironment: vi.fn(() => 0),
    getActiveSessionsForTask: vi.fn(() => []),
    listSessionsForTask: vi.fn(() => []),
    listRunningSubagentChildren: vi.fn(() => []),
    getSession: vi.fn(),
  };
  const settingsStore = { getSetting: vi.fn() };
  const dispatchQueueStore = {
    listPending: vi.fn(() => []),
    dequeue: vi.fn(),
    enqueue: vi.fn(),
  };
  const workspaceEnvironmentLinkStore = { getLinkedEnvironmentIds: vi.fn(() => []) };
  const stores = {
    taskStore,
    workspaceStore,
    personaStore,
    envRegistry,
    sessionStore,
    settingsStore,
    dispatchQueueStore,
    workspaceEnvironmentLinkStore,
  };
  return {
    taskStore,
    workspaceStore,
    personaStore,
    envRegistry,
    sessionStore,
    settingsStore,
    dispatchQueueStore,
    workspaceEnvironmentLinkStore,
    getDatabaseStores: () => stores,
  };
});

import { createCoreReconciliationPhases } from "./reconciliation-setup.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createCoreReconciliationPhases", () => {
  it("returns dispatch, lifecycle-cleanup, subagent-reconciliation, and environment-status phases (no cron, no knowledge-health, no orphan-reparent)", () => {
    const phases = createCoreReconciliationPhases();
    const names = phases.map((p) => p.name);
    expect(names).toEqual([
      "dispatch",
      "lifecycle-cleanup",
      "subagent-reconciliation",
      "environment-status",
    ]);
    expect(names).not.toContain("cron");
    expect(names).not.toContain("orphan-reparent");
    expect(names).not.toContain("knowledge-health");
    expect(phases).toHaveLength(4);
  });
});
