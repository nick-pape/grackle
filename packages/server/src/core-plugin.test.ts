import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginContext } from "@grackle-ai/plugin-sdk";
import type { Logger } from "pino";

// ── Mock dependencies ────────────────────────────────

vi.mock("@grackle-ai/core", () => ({
  subscribe: vi.fn(() => vi.fn()),
  emit: vi.fn(),
  computeTaskStatus: vi.fn(),
  findFirstConnectedEnvironment: vi.fn(),
  startTaskSession: vi.fn(),
  reanimateAgent: vi.fn(),
  isKnowledgeEnabled: vi.fn(() => false),
  createKnowledgeHealthPhase: vi.fn(() => ({ name: "knowledge-health", execute: vi.fn() })),
  neo4jHealthCheck: vi.fn(),
  listConnections: vi.fn(() => new Map()),
  removeConnection: vi.fn(),
  hasCapacity: vi.fn(() => true),
}));

vi.mock("@grackle-ai/plugin-core", () => ({
  createCoreCollector: vi.fn(() => ({
    getHandlers: vi.fn(() => ({
      listEnvironments: vi.fn(),
      addEnvironment: vi.fn(),
      spawnAgent: vi.fn(),
      listWorkspaces: vi.fn(),
    })),
  })),
  createLifecycleSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createRootTaskBootSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createDispatchPhase: vi.fn(() => ({ name: "dispatch", execute: vi.fn() })),
  lifecycleCleanupPhase: { name: "lifecycle-cleanup", execute: vi.fn() },
  createEnvironmentReconciliationPhase: vi.fn(() => ({ name: "environment-status", execute: vi.fn() })),
}));

vi.mock("@grackle-ai/common", () => ({
  grackle: { Grackle: { typeName: "grackle.Grackle" } },
  TASK_STATUS: { NOT_STARTED: "NOT_STARTED", WORKING: "WORKING", FAILED: "FAILED" },
  ROOT_TASK_ID: "system",
}));

vi.mock("@grackle-ai/database", () => ({
  taskStore: { createTask: vi.fn(), setTaskScheduleId: vi.fn(), getTask: vi.fn(), listTasks: vi.fn(), reparentTask: vi.fn(), areDependenciesMet: vi.fn() },
  workspaceStore: { listWorkspaces: vi.fn(() => []) },
  personaStore: { getPersona: vi.fn() },
  envRegistry: { getEnvironment: vi.fn(), listEnvironments: vi.fn(() => []), updateEnvironmentStatus: vi.fn() },
  sessionStore: { listSessionsForTask: vi.fn(), getLatestSessionForTask: vi.fn(), countActiveForEnvironment: vi.fn() },
  settingsStore: { getSetting: vi.fn() },
  dispatchQueueStore: { listPending: vi.fn(() => []), dequeue: vi.fn() },
  workspaceEnvironmentLinkStore: { getLinkedEnvironmentIds: vi.fn(() => []) },
}));

import { createCorePlugin } from "./core-plugin.js";

/** Create a mock PluginContext for testing. */
function createMockContext(overrides?: Partial<PluginContext["config"]>): PluginContext {
  return {
    subscribe: vi.fn(() => vi.fn()),
    emit: vi.fn() as PluginContext["emit"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
    config: {
      grpcPort: 7434,
      webPort: 3000,
      mcpPort: 7435,
      powerlinePort: 7433,
      host: "127.0.0.1",
      grackleHome: "/tmp/grackle",
      apiKey: "test-key",
      skipRootAutostart: true,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createCorePlugin", () => {
  it("returns a valid GracklePlugin with name 'core' and no dependencies", () => {
    const plugin = createCorePlugin();
    expect(plugin.name).toBe("core");
    expect(plugin.dependencies).toBeUndefined();
  });

  it("grpcHandlers returns core-only handlers (no task/persona/finding/escalation)", () => {
    const plugin = createCorePlugin();
    const ctx = createMockContext();
    const registrations = plugin.grpcHandlers!(ctx);

    expect(registrations).toHaveLength(1);
    expect(registrations[0].service).toHaveProperty("typeName", "grackle.Grackle");
    expect(registrations[0].handlers).toHaveProperty("listEnvironments");
    expect(registrations[0].handlers).toHaveProperty("spawnAgent");
    // Orchestration handlers must NOT be in the core plugin
    expect(registrations[0].handlers).not.toHaveProperty("listTasks");
    expect(registrations[0].handlers).not.toHaveProperty("listPersonas");
  });

  it("reconciliationPhases returns core phases without cron or orphan-reparent", () => {
    const plugin = createCorePlugin();
    const ctx = createMockContext();
    const phases = plugin.reconciliationPhases!(ctx);

    const names = phases.map((p) => p.name);
    expect(names).toContain("dispatch");
    expect(names).not.toContain("cron");
    expect(names).toContain("lifecycle-cleanup");
    expect(names).toContain("environment-status");
    // orphan-reparent belongs to the orchestration plugin
    expect(names).not.toContain("orphan-reparent");
  });

  it("eventSubscribers returns only lifecycle when skipRootAutostart is true", () => {
    const plugin = createCorePlugin();
    const ctx = createMockContext({ skipRootAutostart: true });
    const disposables = plugin.eventSubscribers!(ctx);

    expect(disposables.length).toBe(1);
    expect(disposables[0]).toHaveProperty("dispose");
  });

  it("eventSubscribers includes root boot when skipRootAutostart is false", () => {
    const plugin = createCorePlugin();
    const ctx = createMockContext({ skipRootAutostart: false });
    const disposables = plugin.eventSubscribers!(ctx);

    expect(disposables.length).toBe(2);
  });
});
