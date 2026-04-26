import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";

// ── Mock @grackle-ai/database ────────────────────────────────────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("./test-utils/mock-database.js");
  return createDatabaseMock();
});

// ── Mock @grackle-ai/core ────────────────────────────────────────────

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
    streamHub: {
      publish: vi.fn(),
      createStream: vi.fn(() => {
        const iter = (async function* () {})();
        return Object.assign(iter, { cancel: vi.fn() });
      }),
      createGlobalStream: vi.fn(() => {
        const iter = (async function* () {})();
        return Object.assign(iter, { cancel: vi.fn() });
      }),
    },
    streamRegistry: { register: vi.fn() },
    tokenPush: { refreshTokensForTask: vi.fn().mockResolvedValue(undefined) },
    adapterManager: { getConnection: vi.fn(() => ({ id: "mock-conn" })) },
    personasStore: {
      getPersona: vi.fn(() => ({
        id: "system",
        name: "System",
        model: "claude-sonnet-4-5",
        prompt: "",
        systemPrompt: "",
        mcpServers: [],
      })),
    },
    cleanupLifecycleStream: vi.fn(),
    ensureLifecycleStream: vi.fn(),
    processEventStream: vi.fn(),
    processorRegistry: { get: vi.fn(() => undefined), lateBind: vi.fn() },
  };
});

// ── Mock local modules ───────────────────────────────────────────────

vi.mock("./grpc-shared.js", () => ({
  validatePipeInputs: vi.fn(),
  toDialableHost: vi.fn((host: string) => host),
  resolveAncestorEnvironmentId: vi.fn(() => ""),
}));

vi.mock("./lifecycle.js", () => ({
  cleanupLifecycleStream: vi.fn(),
  ensureLifecycleStream: vi.fn(),
}));

vi.mock("./signals/orphan-reparent.js", () => ({
  transferAllPipeSubscriptions: vi.fn(),
}));

vi.mock("./grpc-proto-converters.js", () => ({
  taskRowToProto: vi.fn(),
  sessionRowToProto: vi.fn(),
}));

vi.mock("@grackle-ai/prompt", () => ({
  buildTaskPrompt: vi.fn((title: string) => `Prompt for ${title}`),
  buildOrchestratorContext: vi.fn(() => ({})),
  buildOrchestratorContextInput: vi.fn(() => ({})),
}));

vi.mock("node:path", async () => {
  const actual = await vi.importActual("node:path") as Record<string, unknown>;
  return { ...actual, join: (...parts: string[]) => parts.join("/") };
});

// ── Import AFTER mocks ───────────────────────────────────────────────

import { registerGrackleRoutes } from "./grpc-service.js";
import {
  taskStore,
  sessionStore,
  workspaceStore,
  workspaceEnvironmentLinkStore,
} from "@grackle-ai/database";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getHandlers(): Record<string, (...args: any[]) => any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlers: Record<string, (...args: any[]) => any> = {};
  const fakeRouter = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service(_def: unknown, impl: Record<string, (...args: any[]) => any>) {
      handlers = { ...handlers, ...impl };
    },
  } as unknown as ConnectRouter;
  registerGrackleRoutes(fakeRouter);
  return handlers;
}

function makeTaskRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    title: "Test Task",
    description: "",
    status: "not_started",
    branch: "",
    dependsOn: "[]",
    startedAt: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    sortOrder: 0,
    parentTaskId: "",
    depth: 0,
    canDecompose: false,
    defaultPersonaId: "",
    workpad: "",
    scheduleId: "",
    ...overrides,
  };
}

function makeWorkspaceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ws-1",
    name: "Test Workspace",
    description: "",
    repoUrl: "",
    status: "active",
    useWorktrees: true,
    workingDirectory: "",
    defaultPersonaId: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("startTask environment resolution", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();

    vi.mocked(taskStore.getTask).mockReturnValue(makeTaskRow() as never);
    vi.mocked(taskStore.areDependenciesMet).mockReturnValue(true);
    vi.mocked(sessionStore.listSessionsForTask).mockReturnValue([]);
    vi.mocked(workspaceStore.getWorkspace).mockReturnValue(makeWorkspaceRow() as never);
    vi.mocked(workspaceEnvironmentLinkStore.getLinkedEnvironmentIds).mockReturnValue(["env-linked-1"]);
  });

  it("throws FailedPrecondition when workspace has no linked envs", async () => {
    vi.mocked(workspaceEnvironmentLinkStore.getLinkedEnvironmentIds).mockReturnValue([]);

    const err = await handlers.startTask({
      taskId: "task-1",
      personaId: "",
      environmentId: "",
      notes: "",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("No environment specified");
  });

  it("throws FailedPrecondition when task has no workspace and no env passed", async () => {
    vi.mocked(taskStore.getTask).mockReturnValue(
      makeTaskRow({ workspaceId: null }) as never,
    );
    vi.mocked(workspaceEnvironmentLinkStore.getLinkedEnvironmentIds).mockReturnValue([]);

    const err = await handlers.startTask({
      taskId: "task-1",
      personaId: "",
      environmentId: "",
      notes: "",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
  });
});
