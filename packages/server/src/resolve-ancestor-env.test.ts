/**
 * Unit tests for resolveAncestorEnvironmentId.
 * Verifies walking up the task parent chain to find an ancestor's environmentId.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock heavy dependencies before importing the module ──────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("./test-utils/mock-database.js");
  return createDatabaseMock();
});

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./log-writer.js", () => ({
  initLog: vi.fn(),
  writeEvent: vi.fn(),
  endSession: vi.fn(),
  readLog: vi.fn(() => []),
}));

vi.mock("./stream-hub.js", () => ({
  publish: vi.fn(),
  createStream: vi.fn(() => {
    const iter = (async function* () {})();
    return Object.assign(iter, { cancel: vi.fn() });
  }),
  createGlobalStream: vi.fn(() => {
    const iter = (async function* () {})();
    return Object.assign(iter, { cancel: vi.fn() });
  }),
}));

vi.mock("./ws-broadcast.js", () => ({
  broadcast: vi.fn(),
  setWssInstance: vi.fn(),
  broadcastEnvironments: vi.fn(),
  envRowToWs: vi.fn(),
}));

vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

vi.mock("./token-push.js", () => ({
  pushToEnv: vi.fn(),
  pushProviderCredentialsToEnv: vi.fn(),
  refreshTokensForTask: vi.fn(),
}));

vi.mock("./adapter-manager.js", () => ({
  getAdapter: vi.fn(),
  getConnection: vi.fn(() => undefined),
  setConnection: vi.fn(),
  removeConnection: vi.fn(),
  registerAdapter: vi.fn(),
  startHeartbeat: vi.fn(),
}));

vi.mock("@grackle-ai/adapter-sdk", () => ({
  reconnectOrProvision: vi.fn(async function* () {}),
}));

vi.mock("./utils/system-context.js", () => ({
  buildTaskSystemContext: vi.fn(() => ""),
}));

vi.mock("./utils/slugify.js", () => ({
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-")),
}));

vi.mock("./event-processor.js", () => ({
  processEventStream: vi.fn(),
}));

vi.mock("./processor-registry.js", () => ({
  get: vi.fn(() => undefined),
  lateBind: vi.fn(),
}));

vi.mock("./compute-task-status.js", () => ({
  computeTaskStatus: vi.fn(() => ({ status: "not_started", latestSessionId: "" })),
}));

vi.mock("./github-import.js", () => ({
  importGitHubIssues: vi.fn(),
}));

vi.mock("@grackle-ai/prompt", () => ({
  resolvePersona: vi.fn(() => undefined),
}));

vi.mock("@grackle-ai/mcp", () => ({
  createScopedToken: vi.fn(() => "mock-token"),
}));

vi.mock("./api-key.js", () => ({
  loadOrCreateApiKey: vi.fn(() => "mock-api-key"),
}));

vi.mock("./reanimate-agent.js", () => ({
  reanimateAgent: vi.fn(),
}));

vi.mock("./pairing.js", () => ({
  generatePairingCode: vi.fn(() => "1234"),
}));

vi.mock("./utils/network.js", () => ({
  detectLanIp: vi.fn(() => "127.0.0.1"),
}));

// ── Import AFTER mocks ──────────────────────────────────────────

import { resolveAncestorEnvironmentId } from "./grpc-service.js";
import { sessionStore, taskStore } from "@grackle-ai/database";
import type { SessionRow, TaskRow } from "@grackle-ai/database";

/** Helper to build a minimal SessionRow with an environmentId. */
function makeSession(environmentId: string): SessionRow {
  return {
    id: "sess-1",
    environmentId,
    runtime: "claude-code",
    runtimeSessionId: "",
    prompt: "",
    model: "",
    status: "running",
    logPath: "",
    turns: 0,
    startedAt: "2026-01-01T00:00:00Z",
    suspendedAt: null,
    endedAt: null,
    error: null,
    taskId: "",
    personaId: "",
  };
}

/** Helper to build a minimal TaskRow with a parentTaskId. */
function makeTask(id: string, parentTaskId: string): TaskRow {
  return {
    id,
    workspaceId: null,
    title: "",
    description: "",
    status: "not_started",
    branch: "",
    dependsOn: "[]",
    startedAt: null,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    sortOrder: 0,
    parentTaskId,
    depth: 0,
    canDecompose: false,
    defaultPersonaId: "",
  };
}

describe("resolveAncestorEnvironmentId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns environmentId when the parent has a session", () => {
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(
      makeSession("env-1"),
    );

    expect(resolveAncestorEnvironmentId("parent-1")).toBe("env-1");
    expect(sessionStore.getLatestSessionForTask).toHaveBeenCalledWith("parent-1");
  });

  it("walks up multiple levels to find an ancestor with a session", () => {
    // parent-1 has no session, grandparent-1 does
    vi.mocked(sessionStore.getLatestSessionForTask).mockImplementation((taskId) => {
      if (taskId === "grandparent-1") {
        return makeSession("env-gp");
      }
      return undefined;
    });
    vi.mocked(taskStore.getTask).mockImplementation((taskId) => {
      if (taskId === "parent-1") {
        return makeTask("parent-1", "grandparent-1");
      }
      return undefined;
    });

    expect(resolveAncestorEnvironmentId("parent-1")).toBe("env-gp");
  });

  it("returns empty string when no ancestor has a session", () => {
    // Chain of 3 tasks, none have sessions
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(undefined);
    vi.mocked(taskStore.getTask).mockImplementation((taskId) => {
      if (taskId === "task-1") {
        return makeTask("task-1", "task-2");
      }
      if (taskId === "task-2") {
        return makeTask("task-2", "task-3");
      }
      if (taskId === "task-3") {
        return makeTask("task-3", "");
      }
      return undefined;
    });

    expect(resolveAncestorEnvironmentId("task-1")).toBe("");
  });

  it("returns empty string when parentTaskId is empty", () => {
    expect(resolveAncestorEnvironmentId("")).toBe("");
    expect(sessionStore.getLatestSessionForTask).not.toHaveBeenCalled();
  });

  it("stops at MAX_TASK_DEPTH and returns empty string", () => {
    // Chain of 9 tasks (indices 0–8), only task-9 has a session
    vi.mocked(sessionStore.getLatestSessionForTask).mockImplementation((taskId) => {
      if (taskId === "task-9") {
        return makeSession("env-deep");
      }
      return undefined;
    });
    vi.mocked(taskStore.getTask).mockImplementation((taskId) => {
      const match = taskId.match(/^task-(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        return makeTask(`task-${n}`, `task-${n + 1}`);
      }
      return undefined;
    });

    // Starting at task-1, chain is task-1 → task-2 → ... → task-8 → task-9
    // MAX_TASK_DEPTH is 8, so it checks task-1 through task-8 but never reaches task-9
    expect(resolveAncestorEnvironmentId("task-1")).toBe("");
  });

  it("returns empty string when a task is not found mid-chain", () => {
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(undefined);
    vi.mocked(taskStore.getTask).mockImplementation((taskId) => {
      if (taskId === "task-1") {
        return makeTask("task-1", "task-missing");
      }
      // task-missing not found — should break the chain
      return undefined;
    });

    expect(resolveAncestorEnvironmentId("task-1")).toBe("");
  });
});
