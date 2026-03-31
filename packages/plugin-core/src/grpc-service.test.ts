import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mock collector ────────────────────────────────────────────────────

const addHandlersMock = vi.fn();
const mockCollector = {
  addHandlers: addHandlersMock,
  buildRoutes: vi.fn(() => vi.fn()),
  getHandlers: vi.fn(() => ({})),
};

vi.mock("@grackle-ai/core", () => ({
  createServiceCollector: vi.fn(() => mockCollector),
}));

vi.mock("@grackle-ai/common", () => ({
  grackle: { Grackle: { typeName: "grackle.Grackle" } },
}));

// ── Mock handler modules with one representative method each ─────────────────

vi.mock("./environment-handlers.js", () => ({ listEnvironments: vi.fn() }));
vi.mock("./session-handlers.js", () => ({ spawnAgent: vi.fn() }));
vi.mock("./workspace-handlers.js", () => ({ listWorkspaces: vi.fn() }));
vi.mock("./token-handlers.js", () => ({ getToken: vi.fn() }));
vi.mock("./codespace-handlers.js", () => ({ listCodespaces: vi.fn() }));
vi.mock("./settings-handlers.js", () => ({ getSetting: vi.fn() }));

vi.mock("./task-handlers.js", () => ({ listTasks: vi.fn() }));
vi.mock("./persona-handlers.js", () => ({ listPersonas: vi.fn() }));
vi.mock("./finding-handlers.js", () => ({ postFinding: vi.fn() }));
vi.mock("./escalation-handlers.js", () => ({ createEscalation: vi.fn() }));

import { createCoreCollector, createOrchestrationCollector, createDefaultCollector } from "./grpc-service.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createCoreCollector", () => {
  it("adds environments, sessions, workspaces, tokens, codespaces, settings (no schedules, no knowledge)", () => {
    createCoreCollector();
    const addedModules = addHandlersMock.mock.calls.map(([, module]: [unknown, Record<string, unknown>]) => module);
    expect(addedModules.some((m) => "listEnvironments" in m)).toBe(true);
    expect(addedModules.some((m) => "spawnAgent" in m)).toBe(true);
    expect(addedModules.some((m) => "listWorkspaces" in m)).toBe(true);
    expect(addedModules.some((m) => "getToken" in m)).toBe(true);
    expect(addedModules.some((m) => "listCodespaces" in m)).toBe(true);
    expect(addedModules.some((m) => "getSetting" in m)).toBe(true);
    // Schedules are contributed by @grackle-ai/plugin-scheduling
    expect(addedModules.some((m) => "listSchedules" in m)).toBe(false);
  });

  it("does NOT add task, persona, finding, escalation, or knowledge handlers", () => {
    createCoreCollector();
    const addedModules = addHandlersMock.mock.calls.map(([, module]: [unknown, Record<string, unknown>]) => module);
    expect(addedModules.some((m) => "listTasks" in m)).toBe(false);
    expect(addedModules.some((m) => "listPersonas" in m)).toBe(false);
    expect(addedModules.some((m) => "postFinding" in m)).toBe(false);
    expect(addedModules.some((m) => "createEscalation" in m)).toBe(false);
  });

  it("adds exactly 6 handler groups", () => {
    createCoreCollector();
    expect(addHandlersMock).toHaveBeenCalledTimes(6);
  });
});

describe("createOrchestrationCollector", () => {
  it("adds tasks, personas, findings, and escalations handlers", () => {
    createOrchestrationCollector();
    const addedModules = addHandlersMock.mock.calls.map(([, module]: [unknown, Record<string, unknown>]) => module);
    expect(addedModules.some((m) => "listTasks" in m)).toBe(true);
    expect(addedModules.some((m) => "listPersonas" in m)).toBe(true);
    expect(addedModules.some((m) => "postFinding" in m)).toBe(true);
    expect(addedModules.some((m) => "createEscalation" in m)).toBe(true);
  });

  it("does NOT add core handler groups", () => {
    createOrchestrationCollector();
    const addedModules = addHandlersMock.mock.calls.map(([, module]: [unknown, Record<string, unknown>]) => module);
    expect(addedModules.some((m) => "listEnvironments" in m)).toBe(false);
    expect(addedModules.some((m) => "spawnAgent" in m)).toBe(false);
  });

  it("adds exactly 4 handler groups", () => {
    createOrchestrationCollector();
    expect(addHandlersMock).toHaveBeenCalledTimes(4);
  });
});

describe("createDefaultCollector (regression)", () => {
  it("adds all 10 handler groups including orchestration (knowledge and schedules moved to plugins)", () => {
    createDefaultCollector();
    const addedModules = addHandlersMock.mock.calls.map(([, module]: [unknown, Record<string, unknown>]) => module);
    expect(addedModules.some((m) => "listEnvironments" in m)).toBe(true);
    expect(addedModules.some((m) => "listTasks" in m)).toBe(true);
    expect(addedModules.some((m) => "listPersonas" in m)).toBe(true);
    expect(addedModules.some((m) => "postFinding" in m)).toBe(true);
    expect(addedModules.some((m) => "createEscalation" in m)).toBe(true);
    expect(addHandlersMock).toHaveBeenCalledTimes(10);
  });
});
