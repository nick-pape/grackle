/**
 * Unit tests for the gRPC resumeAgent handler.
 * Verifies status-aware routing: idle → return as-is; running/pending → error; terminal → reanimate.
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
  getActiveForEnv: vi.fn(() => undefined),
  updateSession: vi.fn(),
  updateRuntimeSessionId: vi.fn(),
  reanimateSession: vi.fn(),
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

// ── Import AFTER mocks ──────────────────────────────────────────

import { registerGrackleRoutes } from "./grpc-service.js";
import * as sessionStore from "./session-store.js";
import * as adapterManager from "./adapter-manager.js";
import { processEventStream } from "./event-processor.js";
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

/** Build a minimal session row for testing. */
function makeSession(overrides: Partial<{
  id: string;
  environmentId: string;
  runtime: string;
  runtimeSessionId: string | null;
  prompt: string;
  model: string;
  status: string;
  logPath: string | null;
  turns: number;
  startedAt: string;
  suspendedAt: string | null;
  endedAt: string | null;
  error: string | null;
  taskId: string;
  personaId: string;
}> = {}) {
  return {
    id: "sess-1",
    environmentId: "env-1",
    runtime: "stub",
    runtimeSessionId: "rt-abc",
    prompt: "hello",
    model: "stub-model",
    status: "completed",
    logPath: "/logs/sess-1",
    turns: 1,
    startedAt: "2026-01-01T00:00:00Z",
    suspendedAt: null,
    endedAt: "2026-01-01T00:01:00Z",
    error: null,
    taskId: "",
    personaId: "",
    ...overrides,
  };
}

/** Build a mock adapter connection with a resumable client. */
function makeConnection() {
  return {
    client: {
      resume: vi.fn(() => (async function* () {})()),
    },
  };
}

describe("gRPC resumeAgent", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  it("throws NotFound when session does not exist", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(undefined);

    const err = await handlers.resumeAgent({ sessionId: "no-such" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
    expect(err.message).toContain("no-such");
  });

  it("throws FailedPrecondition when status is IDLE", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(makeSession({ status: "idle" }));

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("already active");
  });

  it("throws FailedPrecondition when status is RUNNING", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(makeSession({ status: "running" }));

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("already active");
  });

  it("throws FailedPrecondition when status is PENDING", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(makeSession({ status: "pending" }));

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("already active");
  });

  it("throws FailedPrecondition when terminal session has no runtimeSessionId", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(
      makeSession({ status: "completed", runtimeSessionId: null }),
    );

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("no runtime session ID");
  });

  it("throws FailedPrecondition when another active session exists on the environment", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(makeSession({ status: "completed" }));
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(
      makeSession({ id: "sess-other", status: "running" }),
    );

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("already has active session");
  });

  it("throws FailedPrecondition when environment is offline (no connection)", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(makeSession({ status: "completed" }));
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    vi.mocked(adapterManager.getConnection).mockReturnValue(undefined);

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("not connected");
  });

  it("reanimates a COMPLETED session: calls reanimateSession and processEventStream", async () => {
    const completedSession = makeSession({ status: "completed" });
    const runningSession = makeSession({ status: "running", endedAt: null });
    vi.mocked(sessionStore.getSession)
      .mockReturnValueOnce(completedSession)
      .mockReturnValueOnce(runningSession);
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    const conn = makeConnection();
    vi.mocked(adapterManager.getConnection).mockReturnValue(conn as never);

    const result = await handlers.resumeAgent({ sessionId: "sess-1" }) as grackle.Session;

    expect(sessionStore.reanimateSession).toHaveBeenCalledWith("sess-1");
    expect(conn.client.resume).toHaveBeenCalled();
    expect(processEventStream).toHaveBeenCalled();
    expect(result.id).toBe("sess-1");
  });

  it("reanimates a FAILED session successfully", async () => {
    const failedSession = makeSession({ status: "failed", error: "timeout" });
    const runningSession = makeSession({ status: "running", error: null });
    vi.mocked(sessionStore.getSession)
      .mockReturnValueOnce(failedSession)
      .mockReturnValueOnce(runningSession);
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    vi.mocked(adapterManager.getConnection).mockReturnValue(makeConnection() as never);

    const result = await handlers.resumeAgent({ sessionId: "sess-1" }) as grackle.Session;

    expect(sessionStore.reanimateSession).toHaveBeenCalledWith("sess-1");
    expect(result.id).toBe("sess-1");
  });

  it("reanimates an INTERRUPTED session successfully", async () => {
    const interruptedSession = makeSession({ status: "interrupted" });
    const runningSession = makeSession({ status: "running" });
    vi.mocked(sessionStore.getSession)
      .mockReturnValueOnce(interruptedSession)
      .mockReturnValueOnce(runningSession);
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    vi.mocked(adapterManager.getConnection).mockReturnValue(makeConnection() as never);

    const result = await handlers.resumeAgent({ sessionId: "sess-1" }) as grackle.Session;

    expect(sessionStore.reanimateSession).toHaveBeenCalledWith("sess-1");
    expect(result.id).toBe("sess-1");
  });
});
