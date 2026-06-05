import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import { setupTestDatabase } from "@grackle-ai/test-utils";

// ── Mock dependencies ───────────────────────────────────────────

// NOTE: @grackle-ai/database is NOT mocked -- real stores run against
// an in-memory SQLite database initialized by setupTestDatabase().

// ── Mock @grackle-ai/core ────────────────────────────────────────────

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
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
    tokenPush: { authenticateForRuntime: vi.fn().mockResolvedValue(undefined) },
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
  const actual = (await vi.importActual("node:path")) as Record<string, unknown>;
  return { ...actual, join: (...parts: string[]) => parts.join("/") };
});

// ── Import AFTER mocks ───────────────────────────────────────────────

import { registerGrackleRoutes } from "./grpc-service.js";
import {
  taskStore,
  sessionStore,
  workspaceStore,
  workspaceEnvironmentLinkStore,
  envRegistry,
} from "@grackle-ai/database";
// @grackle-ai/auth is intentionally NOT mocked here: revokeTask/isRevokedTask use
// the real in-memory revocation set so we can assert lifecycle wiring (F12).
import { isRevokedTask, clearRevocations } from "@grackle-ai/auth";

// ── Test DB ───────────────────────────────────────────────────

const testDb = setupTestDatabase();
afterAll(() => testDb.cleanup());

// ── Helpers ───────────────────────────────────────────────────

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

function insertBaseEntities(): void {
  envRegistry.addEnvironment("env-linked-1", "Linked Env", "local", "{}");
  workspaceStore.createWorkspace("ws-1", "Test Workspace", "", "");
  workspaceEnvironmentLinkStore.linkEnvironment("ws-1", "env-linked-1");
}

function insertTask(
  overrides: {
    id?: string;
    workspaceId?: string;
    title?: string;
    dependsOn?: string[];
    parentTaskId?: string;
    canDecompose?: boolean;
  } = {},
): void {
  const id = overrides.id ?? "task-1";
  const workspaceId = overrides.workspaceId ?? "ws-1";
  const title = overrides.title ?? "Test Task";
  const dependsOn = overrides.dependsOn ?? [];
  const parentTaskId = overrides.parentTaskId ?? "";
  const canDecompose = overrides.canDecompose ?? false;
  taskStore.createTask(id, workspaceId, title, "", dependsOn, "ws-1", parentTaskId, canDecompose);
}

describe("startTask environment resolution", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.clearAllMocks();
    testDb.truncateAll();
    insertBaseEntities();
    insertTask();
    handlers = getHandlers();
  });

  it("throws FailedPrecondition when workspace has no linked envs", async () => {
    // Remove the link so workspace has no envs
    workspaceEnvironmentLinkStore.unlinkEnvironment("ws-1", "env-linked-1");

    const err = (await handlers
      .startTask({
        taskId: "task-1",
        personaId: "",
        environmentId: "",
        notes: "",
      })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("No environment specified");
  });

  it("throws FailedPrecondition when task has no workspace and no env passed", async () => {
    // Insert a task with no workspace
    taskStore.createTask("task-no-ws", undefined, "No WS Task", "", [], "ws-1");

    const err = (await handlers
      .startTask({
        taskId: "task-no-ws",
        personaId: "",
        environmentId: "",
        notes: "",
      })
      .catch((e: unknown) => e)) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
  });
});

describe("scoped-token revocation on task lifecycle (GHSA-f9ff-5x35-7gfw F12)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRevocations();
    testDb.truncateAll();
    insertBaseEntities();
    insertTask();
    handlers = getHandlers();

    // Spy on store methods needed for assertions
    vi.spyOn(taskStore, "deleteTask");
    vi.spyOn(taskStore, "checkAndUnblock");
  });

  // complete/stop are resumable, and resume reuses the original scoped token
  // (powerline `runtime.resume` does not re-mint) -- revoking here would 401 the
  // resumed agent. So only deleteTask (truly terminal) revokes.
  it("completeTask does NOT revoke the task's tokens (resumable)", async () => {
    await handlers.completeTask({ id: "task-1" });
    expect(isRevokedTask("task-1")).toBe(false);
  });

  it("stopTask does NOT revoke the task's tokens (resumable)", async () => {
    await handlers.stopTask({ id: "task-1" });
    expect(isRevokedTask("task-1")).toBe(false);
  });

  it("deleteTask revokes the task's tokens (terminal, never resumed)", async () => {
    expect(isRevokedTask("task-1")).toBe(false);
    await handlers.deleteTask({ id: "task-1" });
    expect(isRevokedTask("task-1")).toBe(true);
  });
});

describe("dependency validation", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let handlers: Record<string, (...args: any[]) => any>;

  beforeEach(() => {
    vi.restoreAllMocks();
    testDb.truncateAll();
    insertBaseEntities();
    handlers = getHandlers();

    // Spy on store methods needed for assertions
    vi.spyOn(taskStore, "updateTask");
  });

  describe("createTask", () => {
    it("rejects nonexistent dependency", async () => {
      const err = (await handlers
        .createTask({
          workspaceId: "ws-1",
          title: "New Task",
          description: "",
          dependsOn: ["nonexistent"],
          parentTaskId: "",
        })
        .catch((e: unknown) => e)) as ConnectError;

      expect(err).toBeInstanceOf(ConnectError);
      expect(err.code).toBe(Code.NotFound);
      expect(err.message).toContain("Task not found");
    });
  });

  describe("updateTask", () => {
    it("rejects self-dependency", async () => {
      insertTask();

      const err = (await handlers
        .updateTask({
          id: "task-1",
          title: "",
          description: "",
          status: 0,
          dependsOn: ["task-1"],
          sessionId: "",
        })
        .catch((e: unknown) => e)) as ConnectError;

      expect(err).toBeInstanceOf(ConnectError);
      expect(err.code).toBe(Code.InvalidArgument);
      expect(err.message).toContain("cannot depend on itself");
    });

    it("rejects nonexistent dependency", async () => {
      insertTask();

      const err = (await handlers
        .updateTask({
          id: "task-1",
          title: "",
          description: "",
          status: 0,
          dependsOn: ["nonexistent"],
          sessionId: "",
        })
        .catch((e: unknown) => e)) as ConnectError;

      expect(err).toBeInstanceOf(ConnectError);
      expect(err.code).toBe(Code.NotFound);
      expect(err.message).toContain("Task not found");
    });

    it("rejects circular dependency", async () => {
      insertTask();
      // Insert a second task that depends on task-1
      insertTask({ id: "task-2", dependsOn: ["task-1"] });

      // Mock detectDependencyCycle to return a specific cycle path for assertion
      vi.spyOn(taskStore, "detectDependencyCycle").mockReturnValue(["task-2", "task-1"]);

      const err = (await handlers
        .updateTask({
          id: "task-1",
          title: "",
          description: "",
          status: 0,
          dependsOn: ["task-2"],
          sessionId: "",
        })
        .catch((e: unknown) => e)) as ConnectError;

      expect(err).toBeInstanceOf(ConnectError);
      expect(err.code).toBe(Code.InvalidArgument);
      expect(err.message).toContain("Circular dependency detected");
    });

    it("allows valid dependency update", async () => {
      insertTask();
      insertTask({ id: "task-2" });

      await handlers.updateTask({
        id: "task-1",
        title: "",
        description: "",
        status: 0,
        dependsOn: ["task-2"],
        sessionId: "",
      });

      expect(taskStore.updateTask).toHaveBeenCalled();
    });

    it("skips validation when dependsOn is empty", async () => {
      insertTask();
      vi.spyOn(taskStore, "detectDependencyCycle");

      await handlers.updateTask({
        id: "task-1",
        title: "",
        description: "",
        status: 0,
        dependsOn: [],
        sessionId: "",
      });

      expect(taskStore.detectDependencyCycle).not.toHaveBeenCalled();
      expect(taskStore.updateTask).toHaveBeenCalled();
    });
  });
});
