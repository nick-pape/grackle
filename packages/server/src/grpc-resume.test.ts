/**
 * Unit tests for the gRPC resumeAgent handler.
 * Verifies status-aware routing: idle/running/pending → FailedPrecondition; terminal → reanimate.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

// ── Mock heavy dependencies before importing the module ──────────

vi.mock("@grackle-ai/database", () => ({
  db: {},
  sqlite: undefined,
  openDatabase: vi.fn(),
  initDatabase: vi.fn(),
  schema: {},
  tokenStore: {
    listTokens: vi.fn(() => []),
    setToken: vi.fn(),
    deleteToken: vi.fn(),
  },
  envRegistry: {
    listEnvironments: vi.fn(() => []),
    getEnvironment: vi.fn(),
    addEnvironment: vi.fn(),
    removeEnvironment: vi.fn(),
    updateEnvironmentStatus: vi.fn(),
    markBootstrapped: vi.fn(),
    resetAllStatuses: vi.fn(),
  },
  sessionStore: {
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
  },
  findingStore: {
    queryFindings: vi.fn(() => []),
    postFinding: vi.fn(),
  },
  personaStore: {
    listPersonas: vi.fn(() => []),
    getPersona: vi.fn(() => undefined),
    getPersonaByName: vi.fn(() => undefined),
    createPersona: vi.fn(),
    updatePersona: vi.fn(),
    deletePersona: vi.fn(),
  },
  taskStore: {
    getTask: vi.fn(() => undefined),
    listTasks: vi.fn(() => []),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    updateTaskStatus: vi.fn(),
    getChildren: vi.fn(() => []),
    deleteTask: vi.fn(),
  },
  workspaceStore: {
    listWorkspaces: vi.fn(() => []),
    getWorkspace: vi.fn(() => undefined),
    createWorkspace: vi.fn(),
    archiveWorkspace: vi.fn(),
    countWorkspacesByEnvironment: vi.fn(() => 0),
  },
  settingsStore: {
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    isAllowedSettingKey: vi.fn(() => true),
    WRITABLE_SETTING_KEYS: new Set(["default_persona_id", "onboarding_completed"]),
  },
  isAllowedSettingKey: vi.fn(() => true),
  WRITABLE_SETTING_KEYS: new Set(["default_persona_id", "onboarding_completed"]),
  credentialProviders: {
    getCredentialProviders: vi.fn(() => ({ claude: "off", github: "off", copilot: "off", codex: "off", goose: "off" })),
    setCredentialProviders: vi.fn(),
    isValidCredentialProviderConfig: vi.fn(() => true),
    VALID_PROVIDERS: ["claude", "github", "copilot", "codex", "goose"],
    VALID_CLAUDE_VALUES: new Set(["off", "subscription", "api_key"]),
    VALID_TOGGLE_VALUES: new Set(["off", "on"]),
    parseCredentialProviderConfig: vi.fn(),
  },
  grackleHome: "/tmp/test-grackle",
  safeParseJsonArray: (value: unknown) => { if (!value) return []; try { const p = JSON.parse(value as string); return Array.isArray(p) ? p.filter((i: unknown) => typeof i === "string") : []; } catch { return []; } },
  slugify: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40),
  encrypt: vi.fn((x: unknown) => x),
  decrypt: vi.fn((x: unknown) => x),
  persistEvent: vi.fn(),
  seedDatabase: vi.fn(),
}));

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

vi.mock("./adapters/adapter.js", () => ({
  reconnectOrProvision: vi.fn(async function* () {}),
}));

vi.mock("./system-prompt-builder.js", () => ({
  SystemPromptBuilder: vi.fn().mockImplementation(() => ({ build: () => "" })),
  buildTaskPrompt: vi.fn((title: string) => title),
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
import { sessionStore, taskStore } from "@grackle-ai/database";
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
    status: "stopped",
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
      makeSession({ status: "stopped", runtimeSessionId: null }),
    );

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("no runtime session ID");
  });

  it("throws FailedPrecondition when another active session exists on the environment", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(makeSession({ status: "stopped" }));
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(
      makeSession({ id: "sess-other", status: "running" }),
    );

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("already has active session");
  });

  it("throws FailedPrecondition when environment is offline (no connection)", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(makeSession({ status: "stopped" }));
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    vi.mocked(adapterManager.getConnection).mockReturnValue(undefined);

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("not connected");
  });

  it("reanimates a STOPPED session: calls reanimateSession and processEventStream", async () => {
    const stoppedSession = makeSession({ status: "stopped" });
    const runningSession = makeSession({ status: "running", endedAt: null });
    vi.mocked(sessionStore.getSession)
      .mockReturnValueOnce(stoppedSession)
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

  it("reanimates a SUSPENDED session successfully", async () => {
    const suspendedSession = makeSession({ status: "suspended" });
    const runningSession = makeSession({ status: "running", error: null });
    vi.mocked(sessionStore.getSession)
      .mockReturnValueOnce(suspendedSession)
      .mockReturnValueOnce(runningSession);
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    vi.mocked(adapterManager.getConnection).mockReturnValue(makeConnection() as never);

    const result = await handlers.resumeAgent({ sessionId: "sess-1" }) as grackle.Session;

    expect(sessionStore.reanimateSession).toHaveBeenCalledWith("sess-1");
    expect(result.id).toBe("sess-1");
  });

  it("can reanimate a session a second time after it stops again", async () => {
    const stoppedSession = makeSession({ status: "stopped" });
    const runningSession = makeSession({ status: "running", endedAt: null });
    const stoppedAgain = makeSession({ status: "stopped" });

    vi.mocked(sessionStore.getSession)
      .mockReturnValueOnce(stoppedSession)    // first reanimate: lookup
      .mockReturnValueOnce(runningSession)    // first reanimate: return value
      .mockReturnValueOnce(stoppedAgain)      // second reanimate: lookup
      .mockReturnValueOnce(runningSession);   // second reanimate: return value
    vi.mocked(sessionStore.getActiveForEnv).mockReturnValue(undefined);
    vi.mocked(adapterManager.getConnection).mockReturnValue(makeConnection() as never);

    await handlers.resumeAgent({ sessionId: "sess-1" });
    await handlers.resumeAgent({ sessionId: "sess-1" });

    expect(sessionStore.reanimateSession).toHaveBeenCalledTimes(2);
    expect(processEventStream).toHaveBeenCalledTimes(2);
  });
});

describe("gRPC resumeTask", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  it("throws NotFound when task does not exist", async () => {
    vi.mocked(taskStore.getTask).mockReturnValue(undefined);

    const err = await handlers.resumeTask({ id: "task-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
  });

  it("throws FailedPrecondition when task has no sessions", async () => {
    vi.mocked(taskStore.getTask).mockReturnValue({ id: "task-1", workspaceId: "proj-1" } as never);
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(undefined);

    const err = await handlers.resumeTask({ id: "task-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
  });

  it("throws FailedPrecondition when latest session has no runtimeSessionId", async () => {
    vi.mocked(taskStore.getTask).mockReturnValue({ id: "task-1", workspaceId: "proj-1" } as never);
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(
      makeSession({ status: "stopped", runtimeSessionId: null }),
    );

    const err = await handlers.resumeTask({ id: "task-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("no runtime session ID");
  });

  it("succeeds when latest session has a runtimeSessionId (happy path)", async () => {
    const task = { id: "task-1", workspaceId: "proj-1" };
    const session = makeSession({ status: "stopped", runtimeSessionId: "rt-abc" });
    const runningSession = makeSession({ status: "running" });
    vi.mocked(taskStore.getTask).mockReturnValue(task as never);
    vi.mocked(sessionStore.getLatestSessionForTask).mockReturnValue(session);
    vi.mocked(sessionStore.getSession).mockReturnValue(runningSession);
    vi.mocked(adapterManager.getConnection).mockReturnValue(makeConnection() as never);

    const result = await handlers.resumeTask({ id: "task-1" }) as grackle.Session;

    expect(processEventStream).toHaveBeenCalled();
    expect(result.id).toBe("sess-1");
  });
});
