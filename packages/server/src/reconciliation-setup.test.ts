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
  createOrphanPhase: vi.fn((deps: unknown) => ({ name: "orphan-reparent", execute: async () => {}, _deps: deps })),
  createDispatchPhase: vi.fn((deps: unknown) => ({ name: "dispatch", execute: async () => {}, _deps: deps })),
  lifecycleCleanupPhase: { name: "lifecycle-cleanup", execute: async () => {} },
  createEnvironmentReconciliationPhase: vi.fn(() => ({ name: "environment-status", execute: async () => {} })),
}));

vi.mock("@grackle-ai/common", () => ({
  TASK_STATUS: { NOT_STARTED: "not_started", WORKING: "working", PAUSED: "paused", COMPLETE: "complete", FAILED: "failed" },
  ROOT_TASK_ID: "system",
}));

vi.mock("@grackle-ai/database", () => ({
  taskStore: {
    createTask: vi.fn(),
    setTaskScheduleId: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(() => []),
    areDependenciesMet: vi.fn(() => true),
    reparentTask: vi.fn(),
  },
  workspaceStore: {
    listWorkspaces: vi.fn(() => []),
    getWorkspace: vi.fn(),
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

import { createReconciliationPhases } from "./reconciliation-setup.js";
import { isKnowledgeEnabled, createKnowledgeHealthPhase, neo4jHealthCheck } from "@grackle-ai/core";
import { createOrphanPhase } from "@grackle-ai/plugin-core";
import { workspaceStore, taskStore } from "@grackle-ai/database";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createReconciliationPhases", () => {
  it("returns dispatch, lifecycle-cleanup, orphan-reparent, and environment phases (no cron — scheduling plugin owns that)", () => {
    const phases = createReconciliationPhases();
    const names = phases.map((p) => p.name);
    expect(names).toEqual(["dispatch", "lifecycle-cleanup", "orphan-reparent", "environment-status"]);
    expect(names).not.toContain("cron");
  });

  it("includes knowledge-health phase when knowledge is enabled", () => {
    (isKnowledgeEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const phases = createReconciliationPhases();
    const names = phases.map((p) => p.name);
    expect(names).toContain("knowledge-health");
    expect(phases).toHaveLength(5);
  });

  it("omits knowledge-health phase when knowledge is disabled", () => {
    (isKnowledgeEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const phases = createReconciliationPhases();
    const names = phases.map((p) => p.name);
    expect(names).not.toContain("knowledge-health");
  });

  it("passes neo4jHealthCheck to knowledge health phase", () => {
    (isKnowledgeEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    createReconciliationPhases();
    expect(createKnowledgeHealthPhase).toHaveBeenCalledWith({ healthCheck: neo4jHealthCheck });
  });

  it("orphan phase listAllTasks aggregates tasks across all workspaces", () => {
    const ws1Tasks = [{ id: "t1" }];
    const ws2Tasks = [{ id: "t2" }, { id: "t3" }];
    (workspaceStore.listWorkspaces as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: "ws1" }, { id: "ws2" },
    ]);
    (taskStore.listTasks as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(ws1Tasks)
      .mockReturnValueOnce(ws2Tasks);

    createReconciliationPhases();

    // Extract the deps passed to createOrphanPhase and call listAllTasks
    const orphanDeps = (createOrphanPhase as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      listAllTasks: () => Array<{ id: string }>;
    };
    const allTasks = orphanDeps.listAllTasks();
    expect(allTasks).toEqual([{ id: "t1" }, { id: "t2" }, { id: "t3" }]);
  });
});
