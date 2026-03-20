/**
 * Unit tests for the gRPC getSession handler.
 * Verifies direct session lookup by ID and proper NOT_FOUND error.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

// ── Mock heavy dependencies before importing the module ──────────

vi.mock("./db.js", async () => {
  return await import("./test-db.js");
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

vi.mock("./token-broker.js", () => ({
  pushToEnv: vi.fn(),
  pushProviderCredentialsToEnv: vi.fn(),
  refreshTokensForTask: vi.fn(),
  listTokens: vi.fn(() => []),
  setToken: vi.fn(),
  deleteToken: vi.fn(),
}));

vi.mock("./env-registry.js", () => ({
  listEnvironments: vi.fn(() => []),
  getEnvironment: vi.fn(),
  addEnvironment: vi.fn(),
  removeEnvironment: vi.fn(),
  updateEnvironmentStatus: vi.fn(),
  markBootstrapped: vi.fn(),
  resetAllStatuses: vi.fn(),
}));

vi.mock("./session-store.js", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(() => undefined),
  listSessions: vi.fn(() => []),
  listSessionsForTask: vi.fn(() => []),
  listSessionsByTaskIds: vi.fn(() => []),
  getLatestSessionForTask: vi.fn(() => undefined),
  getActiveSessionsForTask: vi.fn(() => []),
  updateSession: vi.fn(),
  deleteByEnvironment: vi.fn(),
  setSessionTask: vi.fn(),
}));

vi.mock("./adapter-manager.js", () => ({
  getAdapter: vi.fn(),
  getConnection: vi.fn(() => undefined),
  setConnection: vi.fn(),
  removeConnection: vi.fn(),
  registerAdapter: vi.fn(),
  startHeartbeat: vi.fn(),
}));

vi.mock("./finding-store.js", () => ({
  queryFindings: vi.fn(() => []),
  postFinding: vi.fn(),
}));

vi.mock("./persona-store.js", () => ({
  listPersonas: vi.fn(() => []),
  getPersona: vi.fn(() => undefined),
  getPersonaByName: vi.fn(() => undefined),
  createPersona: vi.fn(),
  updatePersona: vi.fn(),
  deletePersona: vi.fn(),
}));

vi.mock("./adapters/adapter.js", () => ({
  reconnectOrProvision: vi.fn(async function* () {}),
}));

vi.mock("./system-prompt-builder.js", () => ({
  SystemPromptBuilder: vi.fn().mockImplementation(() => ({ build: () => "" })),
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

// ── Import AFTER mocks ──────────────────────────────────────────

import { registerGrackleRoutes } from "./grpc-service.js";
import * as sessionStore from "./session-store.js";
import type { ConnectRouter } from "@connectrpc/connect";
import type { grackle } from "@grackle-ai/common";

/**
 * Extract the service handlers from `registerGrackleRoutes` by
 * calling it with a fake router that captures the method map.
 */
function getHandlers(): Record<string, (...args: unknown[]) => unknown> {
  let handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const fakeRouter = {
    service(_def: unknown, impl: Record<string, (...args: unknown[]) => unknown>) {
      handlers = impl;
    },
  } as unknown as ConnectRouter;
  registerGrackleRoutes(fakeRouter);
  return handlers;
}

describe("gRPC getSession", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  it("returns the session when found", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue({
      id: "sess-abc",
      environmentId: "env-1",
      runtime: "claude-code",
      runtimeSessionId: "rt-1",
      prompt: "hello",
      model: "claude-sonnet-4-20250514",
      status: "running",
      logPath: "/logs/sess-abc",
      turns: 3,
      startedAt: "2026-01-01T00:00:00Z",
      suspendedAt: null,
      endedAt: null,
      error: null,
      taskId: "",
      personaId: "",
    });

    const result = await handlers.getSession({ id: "sess-abc" }) as grackle.Session;

    expect(sessionStore.getSession).toHaveBeenCalledWith("sess-abc");
    expect(result.id).toBe("sess-abc");
    expect(result.environmentId).toBe("env-1");
    expect(result.runtime).toBe("claude-code");
    expect(result.status).toBe("running");
    expect(result.logPath).toBe("/logs/sess-abc");
    expect(result.turns).toBe(3);
  });

  it("throws ConnectError with NOT_FOUND when session does not exist", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(undefined);

    const err = await handlers.getSession({ id: "nonexistent" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
    expect(err.message).toContain("nonexistent");
  });
});
