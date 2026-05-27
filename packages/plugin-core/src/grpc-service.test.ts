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
  grackle: {
    GrackleCore: { typeName: "grackle.GrackleCore" },
    GrackleOrchestration: { typeName: "grackle.GrackleOrchestration" },
  },
  GRACKLE_DIR: ".grackle",
}));

// ── Mock handler modules with one representative method each ─────────────────

vi.mock("./environment-handlers.js", () => ({ listEnvironments: vi.fn() }));
vi.mock("./session-handlers.js", () => ({ spawnAgent: vi.fn() }));
vi.mock("./workspace-handlers.js", () => ({ listWorkspaces: vi.fn() }));
vi.mock("./token-handlers.js", () => ({ getToken: vi.fn() }));
vi.mock("./codespace-handlers.js", () => ({ listCodespaces: vi.fn() }));
vi.mock("./docker-handlers.js", () => ({ listDockerContainers: vi.fn() }));
vi.mock("./settings-handlers.js", () => ({ getSetting: vi.fn() }));

vi.mock("./task-handlers.js", () => ({ listTasks: vi.fn() }));
vi.mock("./persona-handlers.js", () => ({ listPersonas: vi.fn() }));
vi.mock("./component-handlers.js", () => ({
  registerComponent: vi.fn(),
  updateComponent: vi.fn(),
  getComponent: vi.fn(),
  listComponents: vi.fn(),
}));
vi.mock("./escalation-handlers.js", () => ({ createEscalation: vi.fn() }));
vi.mock("./plugin-handlers.js", () => ({ listPlugins: vi.fn(), setPluginEnabled: vi.fn() }));
vi.mock("./github-account-handlers.js", () => ({ listGitHubAccounts: vi.fn() }));
vi.mock("./channel-handlers.js", () => ({
  exposeChannel: vi.fn(),
  listChannelGrants: vi.fn(),
  revokeChannelGrant: vi.fn(),
}));
vi.mock("./event-handlers.js", () => ({
  queryDomainEvents: vi.fn(),
  getStreamTranscript: vi.fn(),
  getSessionActions: vi.fn(),
}));
vi.mock("./runtime-handlers.js", () => ({ listRuntimes: vi.fn() }));

import {
  createCoreCollector,
  createOrchestrationCollector,
  createDefaultCollector,
} from "./grpc-service.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createCoreCollector", () => {
  it("adds environments, sessions, workspaces, tokens, codespaces, docker containers, settings (no schedules, no knowledge)", () => {
    createCoreCollector();
    const addedModules = addHandlersMock.mock.calls.map(
      ([, module]: [unknown, Record<string, unknown>]) => module,
    );
    expect(addedModules.some((m) => "listEnvironments" in m)).toBe(true);
    expect(addedModules.some((m) => "spawnAgent" in m)).toBe(true);
    expect(addedModules.some((m) => "listWorkspaces" in m)).toBe(true);
    expect(addedModules.some((m) => "getToken" in m)).toBe(true);
    expect(addedModules.some((m) => "listCodespaces" in m)).toBe(true);
    expect(addedModules.some((m) => "listDockerContainers" in m)).toBe(true);
    expect(addedModules.some((m) => "getSetting" in m)).toBe(true);
    // Plugin management handlers are registered in core
    expect(addedModules.some((m) => "listPlugins" in m)).toBe(true);
    // GitHub account handlers are registered in core
    expect(addedModules.some((m) => "listGitHubAccounts" in m)).toBe(true);
    // Channel handlers are registered in core
    expect(addedModules.some((m) => "exposeChannel" in m)).toBe(true);
    // Domain-event query handler is registered in core
    expect(addedModules.some((m) => "queryDomainEvents" in m)).toBe(true);
    // Session-action log reader is registered in core (RFC #1264 / AHP HR1a)
    expect(addedModules.some((m) => "getSessionActions" in m)).toBe(true);
    // Runtime catalog (AHP RootState.agents) is registered in core (#1288)
    expect(addedModules.some((m) => "listRuntimes" in m)).toBe(true);
    // Schedules are contributed by @grackle-ai/plugin-scheduling
    expect(addedModules.some((m) => "listSchedules" in m)).toBe(false);
  });

  it("does NOT add task, persona, escalation, or knowledge handlers", () => {
    createCoreCollector();
    const addedModules = addHandlersMock.mock.calls.map(
      ([, module]: [unknown, Record<string, unknown>]) => module,
    );
    expect(addedModules.some((m) => "listTasks" in m)).toBe(false);
    expect(addedModules.some((m) => "listPersonas" in m)).toBe(false);
    expect(addedModules.some((m) => "createEscalation" in m)).toBe(false);
  });

  it("adds exactly 12 handler groups", () => {
    createCoreCollector();
    expect(addHandlersMock).toHaveBeenCalledTimes(12);
  });
});

describe("createOrchestrationCollector", () => {
  it("adds tasks, personas, components, and escalations handlers", () => {
    createOrchestrationCollector();
    const addedModules = addHandlersMock.mock.calls.map(
      ([, module]: [unknown, Record<string, unknown>]) => module,
    );
    expect(addedModules.some((m) => "listTasks" in m)).toBe(true);
    expect(addedModules.some((m) => "listPersonas" in m)).toBe(true);
    expect(addedModules.some((m) => "registerComponent" in m)).toBe(true);
    expect(addedModules.some((m) => "createEscalation" in m)).toBe(true);
  });

  it("does NOT add core handler groups", () => {
    createOrchestrationCollector();
    const addedModules = addHandlersMock.mock.calls.map(
      ([, module]: [unknown, Record<string, unknown>]) => module,
    );
    expect(addedModules.some((m) => "listEnvironments" in m)).toBe(false);
    expect(addedModules.some((m) => "spawnAgent" in m)).toBe(false);
  });

  it("adds exactly 4 handler groups", () => {
    createOrchestrationCollector();
    expect(addHandlersMock).toHaveBeenCalledTimes(4);
  });
});

describe("createDefaultCollector (regression)", () => {
  it("adds all 16 handler groups including orchestration, components, plugins, github accounts, channels, domain events, and runtime catalog (knowledge and schedules moved to plugins)", () => {
    createDefaultCollector();
    const addedModules = addHandlersMock.mock.calls.map(
      ([, module]: [unknown, Record<string, unknown>]) => module,
    );
    expect(addedModules.some((m) => "listEnvironments" in m)).toBe(true);
    expect(addedModules.some((m) => "listTasks" in m)).toBe(true);
    expect(addedModules.some((m) => "listPersonas" in m)).toBe(true);
    expect(addedModules.some((m) => "registerComponent" in m)).toBe(true);
    expect(addedModules.some((m) => "createEscalation" in m)).toBe(true);
    expect(addedModules.some((m) => "listPlugins" in m)).toBe(true);
    expect(addedModules.some((m) => "listGitHubAccounts" in m)).toBe(true);
    expect(addedModules.some((m) => "listDockerContainers" in m)).toBe(true);
    expect(addedModules.some((m) => "exposeChannel" in m)).toBe(true);
    expect(addedModules.some((m) => "queryDomainEvents" in m)).toBe(true);
    expect(addedModules.some((m) => "getSessionActions" in m)).toBe(true);
    expect(addedModules.some((m) => "listRuntimes" in m)).toBe(true);
    expect(addHandlersMock).toHaveBeenCalledTimes(16);
  });
});
