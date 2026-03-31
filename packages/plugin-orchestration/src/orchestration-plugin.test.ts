import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock("@grackle-ai/core", () => ({
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock("@grackle-ai/common", () => ({
  grackle: { Grackle: { typeName: "grackle.Grackle" } },
}));

vi.mock("@grackle-ai/database", () => ({
  taskStore: {
    listTasks: vi.fn(() => []),
    reparentTask: vi.fn(),
  },
}));

vi.mock("@grackle-ai/plugin-core", () => ({
  // Orchestration collector — returns handlers with representative methods
  createOrchestrationCollector: vi.fn(() => ({
    getHandlers: vi.fn(() => ({
      listTasks: vi.fn(),
      createTask: vi.fn(),
      listPersonas: vi.fn(),
      createPersona: vi.fn(),
      postFinding: vi.fn(),
      queryFindings: vi.fn(),
      createEscalation: vi.fn(),
      listEscalations: vi.fn(),
    })),
  })),
  // Phases
  createOrphanPhase: vi.fn((deps: unknown) => ({ name: "orphan-reparent", execute: async () => {}, _deps: deps })),
  // Subscribers
  createSigchldSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createEscalationAutoSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
  createOrphanReparentSubscriber: vi.fn(() => ({ dispose: vi.fn() })),
}));

import { createOrchestrationPlugin } from "./orchestration-plugin.js";
import {
  createOrphanPhase,
  createSigchldSubscriber,
  createEscalationAutoSubscriber,
  createOrphanReparentSubscriber,
} from "@grackle-ai/plugin-core";
import { taskStore } from "@grackle-ai/database";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Minimal PluginContext for tests. */
function createCtx(): { subscribe: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> } {
  return { subscribe: vi.fn(() => vi.fn()), emit: vi.fn() };
}

describe("createOrchestrationPlugin", () => {
  it("name is 'orchestration' and dependencies includes 'core'", () => {
    const plugin = createOrchestrationPlugin();
    expect(plugin.name).toBe("orchestration");
    expect(plugin.dependencies).toContain("core");
  });

  it("grpcHandlers returns a single ServiceRegistration with orchestration methods", () => {
    const plugin = createOrchestrationPlugin();
    const registrations = plugin.grpcHandlers!(createCtx() as never);

    expect(registrations).toHaveLength(1);
    expect(registrations[0].service).toHaveProperty("typeName", "grackle.Grackle");
    // Representative methods from each handler group
    expect(registrations[0].handlers).toHaveProperty("listTasks");
    expect(registrations[0].handlers).toHaveProperty("createTask");
    expect(registrations[0].handlers).toHaveProperty("listPersonas");
    expect(registrations[0].handlers).toHaveProperty("createPersona");
    expect(registrations[0].handlers).toHaveProperty("postFinding");
    expect(registrations[0].handlers).toHaveProperty("queryFindings");
    expect(registrations[0].handlers).toHaveProperty("createEscalation");
    expect(registrations[0].handlers).toHaveProperty("listEscalations");
    // Core handlers must NOT be in the orchestration plugin
    expect(registrations[0].handlers).not.toHaveProperty("listEnvironments");
    expect(registrations[0].handlers).not.toHaveProperty("spawnAgent");
  });

  it("reconciliationPhases returns only the orphan-reparent phase", () => {
    const plugin = createOrchestrationPlugin();
    const phases = plugin.reconciliationPhases!(createCtx() as never);

    expect(phases).toHaveLength(1);
    expect(phases[0].name).toBe("orphan-reparent");
  });

  it("reconciliationPhases wires orphan listAllTasks to taskStore.listTasks() and emit to ctx.emit", () => {
    const allTasks = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
    (taskStore.listTasks as ReturnType<typeof vi.fn>).mockReturnValue(allTasks);

    const plugin = createOrchestrationPlugin();
    const ctx = createCtx();
    plugin.reconciliationPhases!(ctx as never);

    const orphanDeps = (createOrphanPhase as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      listAllTasks: () => Array<{ id: string }>;
      emit: unknown;
    };
    expect(orphanDeps.listAllTasks()).toEqual(allTasks);
    expect(taskStore.listTasks).toHaveBeenCalledWith();
    expect(orphanDeps.emit).toBe(ctx.emit);
  });

  it("eventSubscribers returns exactly 3 disposables (sigchld, escalation-auto, orphan-reparent)", () => {
    const plugin = createOrchestrationPlugin();
    const ctx = createCtx();
    const disposables = plugin.eventSubscribers!(ctx as never);

    expect(disposables).toHaveLength(3);
    for (const d of disposables) {
      expect(d).toHaveProperty("dispose");
    }

    expect(createSigchldSubscriber).toHaveBeenCalledOnce();
    expect(createEscalationAutoSubscriber).toHaveBeenCalledOnce();
    expect(createOrphanReparentSubscriber).toHaveBeenCalledOnce();
  });
});
