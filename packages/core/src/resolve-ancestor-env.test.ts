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

vi.mock("./event-bus.js", () => ({
  emit: vi.fn(),
}));

vi.mock("./token-push.js", () => ({
  authenticateForRuntime: vi.fn(),
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

import { resolveAncestorEnvironmentId } from "./grpc-shared-utils.js";
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
    vi.mocked(taskStore.getAncestors).mockReturnValue([]);
    vi.mocked(sessionStore.getLatestSessionsByTaskIds).mockReturnValue(
      new Map([["parent-1", makeSession("env-1")]]),
    );

    expect(resolveAncestorEnvironmentId("parent-1")).toBe("env-1");
    expect(sessionStore.getLatestSessionsByTaskIds).toHaveBeenCalledWith(["parent-1"]);
  });

  it("walks up multiple levels to find an ancestor with a session", () => {
    // getAncestors returns root-first: [grandparent, parent-of-parentTaskId]
    // but parentTaskId="parent-1" so ancestors are OF parent-1
    vi.mocked(taskStore.getAncestors).mockReturnValue([makeTask("grandparent-1", "")]);
    // Only grandparent has a session
    vi.mocked(sessionStore.getLatestSessionsByTaskIds).mockReturnValue(
      new Map([["grandparent-1", makeSession("env-gp")]]),
    );

    expect(resolveAncestorEnvironmentId("parent-1")).toBe("env-gp");
  });

  it("returns empty string when no ancestor has a session", () => {
    vi.mocked(taskStore.getAncestors).mockReturnValue([
      makeTask("task-3", ""),
      makeTask("task-2", "task-3"),
    ]);
    vi.mocked(sessionStore.getLatestSessionsByTaskIds).mockReturnValue(new Map());

    expect(resolveAncestorEnvironmentId("task-1")).toBe("");
  });

  it("returns empty string when parentTaskId is empty", () => {
    expect(resolveAncestorEnvironmentId("")).toBe("");
    expect(sessionStore.getLatestSessionsByTaskIds).not.toHaveBeenCalled();
  });

  it("prefers nearest ancestor when multiple have sessions", () => {
    vi.mocked(taskStore.getAncestors).mockReturnValue([
      makeTask("root", ""),
      makeTask("mid", "root"),
    ]);
    vi.mocked(sessionStore.getLatestSessionsByTaskIds).mockReturnValue(
      new Map([
        ["parent-1", makeSession("env-nearest")],
        ["root", makeSession("env-root")],
      ]),
    );

    expect(resolveAncestorEnvironmentId("parent-1")).toBe("env-nearest");
  });

  it("returns empty string when getAncestors returns empty and parent has no session", () => {
    vi.mocked(taskStore.getAncestors).mockReturnValue([]);
    vi.mocked(sessionStore.getLatestSessionsByTaskIds).mockReturnValue(new Map());

    expect(resolveAncestorEnvironmentId("orphan-task")).toBe("");
  });

  it("skips sessions without environmentId", () => {
    vi.mocked(taskStore.getAncestors).mockReturnValue([makeTask("grandparent", "")]);
    vi.mocked(sessionStore.getLatestSessionsByTaskIds).mockReturnValue(
      new Map([
        ["parent-1", makeSession("")],
        ["grandparent", makeSession("env-gp")],
      ]),
    );

    expect(resolveAncestorEnvironmentId("parent-1")).toBe("env-gp");
  });
});
