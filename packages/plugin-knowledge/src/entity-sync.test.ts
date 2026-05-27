import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GrackleEvent, PluginContext } from "@grackle-ai/plugin-sdk";

// ── Mocks ────────────────────────────────────────────────────

const project = vi.hoisted(() => ({
  projectTask: vi.fn().mockResolvedValue(undefined),
  unprojectTask: vi.fn().mockResolvedValue(undefined),
  projectWorkspace: vi.fn().mockResolvedValue(undefined),
  projectPersona: vi.fn().mockResolvedValue(undefined),
  unprojectPersona: vi.fn().mockResolvedValue(undefined),
  unprojectEnvironment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./projection/project-entity.js", () => project);

const stores = vi.hoisted(() => ({
  getTask: vi.fn(),
  getWorkspace: vi.fn(),
  getPersona: vi.fn(),
}));
vi.mock("@grackle-ai/database", () => ({
  taskStore: { getTask: stores.getTask },
  workspaceStore: { getWorkspace: stores.getWorkspace },
  personaStore: { getPersona: stores.getPersona },
}));

const gates = vi.hoisted(() => ({
  getEmbedder: vi.fn(() => ({}) as unknown),
  isHealthy: vi.fn(() => true),
}));
vi.mock("./knowledge-init.js", () => ({ getKnowledgeEmbedder: gates.getEmbedder }));
vi.mock("./knowledge-health.js", () => ({ isNeo4jHealthy: gates.isHealthy }));
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createEntitySyncSubscriber } from "./entity-sync.js";

// ── Helpers ──────────────────────────────────────────────────

function makeHarness(): { ctx: PluginContext; fire: (event: GrackleEvent) => void } {
  let callback: ((event: GrackleEvent) => void) | undefined;
  const ctx = {
    subscribe: (fn: (event: GrackleEvent) => void) => {
      callback = fn;
      return vi.fn();
    },
    emit: vi.fn(),
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: {},
  } as unknown as PluginContext;
  return { ctx, fire: (event) => callback?.(event) };
}

function evt(type: GrackleEvent["type"], payload: Record<string, unknown>): GrackleEvent {
  return { id: "e1", type, timestamp: "2026-01-01T00:00:00Z", payload };
}

/** Flush the fire-and-forget async handler. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("createEntitySyncSubscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gates.getEmbedder.mockReturnValue({});
    gates.isHealthy.mockReturnValue(true);
  });

  it("projects a task on task.updated when the row exists", async () => {
    stores.getTask.mockReturnValue({ id: "t1", title: "T" });
    const { ctx, fire } = makeHarness();
    createEntitySyncSubscriber(ctx);
    fire(evt("task.updated", { taskId: "t1" }));
    await flush();
    expect(project.projectTask).toHaveBeenCalledWith({ id: "t1", title: "T" });
  });

  it("does not project when the task row is missing", async () => {
    stores.getTask.mockReturnValue(undefined);
    const { ctx, fire } = makeHarness();
    createEntitySyncSubscriber(ctx);
    fire(evt("task.created", { taskId: "gone" }));
    await flush();
    expect(project.projectTask).not.toHaveBeenCalled();
  });

  it("unprojects on task.deleted / persona.deleted / environment.removed", async () => {
    const { ctx, fire } = makeHarness();
    createEntitySyncSubscriber(ctx);
    fire(evt("task.deleted", { taskId: "t1" }));
    fire(evt("persona.deleted", { personaId: "p1" }));
    fire(evt("environment.removed", { environmentId: "e1" }));
    await flush();
    expect(project.unprojectTask).toHaveBeenCalledWith("t1");
    expect(project.unprojectPersona).toHaveBeenCalledWith("p1");
    expect(project.unprojectEnvironment).toHaveBeenCalledWith("e1");
  });

  it("re-projects a workspace on workspace.archived (archive is not delete)", async () => {
    stores.getWorkspace.mockReturnValue({ id: "w1", name: "W", status: "archived" });
    const { ctx, fire } = makeHarness();
    createEntitySyncSubscriber(ctx);
    fire(evt("workspace.archived", { workspaceId: "w1" }));
    await flush();
    expect(project.projectWorkspace).toHaveBeenCalledWith({
      id: "w1",
      name: "W",
      status: "archived",
    });
  });

  it("skips projection when Neo4j is unhealthy", async () => {
    gates.isHealthy.mockReturnValue(false);
    stores.getTask.mockReturnValue({ id: "t1" });
    const { ctx, fire } = makeHarness();
    createEntitySyncSubscriber(ctx);
    fire(evt("task.updated", { taskId: "t1" }));
    await flush();
    expect(project.projectTask).not.toHaveBeenCalled();
  });

  it("ignores events handled by the reconciliation phase (e.g. environment.changed)", async () => {
    const { ctx, fire } = makeHarness();
    createEntitySyncSubscriber(ctx);
    fire(evt("environment.changed", {}));
    await flush();
    expect(project.projectWorkspace).not.toHaveBeenCalled();
    expect(project.unprojectEnvironment).not.toHaveBeenCalled();
  });
});
