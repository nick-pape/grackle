/**
 * Unit tests for the gRPC resumeAgent handler.
 * Verifies status-aware routing: idle/running/pending → FailedPrecondition; terminal → reanimate.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

// ── Mock heavy dependencies before importing the module ──────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("./test-utils/mock-database.js");
  return createDatabaseMock();
});

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logWriter: {
      initLog: vi.fn(),
      writeEvent: vi.fn(),
      endSession: vi.fn(),
      readLog: vi.fn(() => []),
    },
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
    tokenPush: {
      pushToEnv: vi.fn(),
      pushProviderCredentialsToEnv: vi.fn(),
      refreshTokensForTask: vi.fn(),
    },
    adapterManager: {
      getAdapter: vi.fn(),
      getConnection: vi.fn(() => undefined),
      setConnection: vi.fn(),
      removeConnection: vi.fn(),
      registerAdapter: vi.fn(),
      startHeartbeat: vi.fn(),
    },
    processEventStream: vi.fn(),
    processorRegistry: {
      get: vi.fn(() => undefined),
      lateBind: vi.fn(),
    },
    cleanupLifecycleStream: vi.fn(),
    ensureLifecycleStream: vi.fn(),
    reanimateAgent: vi.fn(),
  };
});

vi.mock("@grackle-ai/prompt", () => ({
  SystemPromptBuilder: vi.fn().mockImplementation(() => ({ build: () => "" })),
  buildTaskPrompt: vi.fn((title: string) => title),
}));

vi.mock("./utils/slugify.js", () => ({
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-")),
}));

vi.mock("./compute-task-status.js", () => ({
  computeTaskStatus: vi.fn(() => ({ status: "not_started", latestSessionId: "" })),
}));

// ── Import AFTER mocks ──────────────────────────────────────────

import { registerGrackleRoutes } from "./grpc-service.js";
import { sessionStore, taskStore } from "@grackle-ai/database";
import { adapterManager, processEventStream, ensureLifecycleStream, reanimateAgent } from "@grackle-ai/core";
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
      handlers = { ...handlers, ...impl };
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
  parentSessionId: string;
  pipeMode: string;
  endReason: string | null;
  inputTokens: number;
  outputTokens: number;
  costMillicents: number;
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
    parentSessionId: "",
    pipeMode: "",
    endReason: null,
    inputTokens: 0,
    outputTokens: 0,
    costMillicents: 0,
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

  it("throws NotFound when reanimateAgent throws NotFound", async () => {
    vi.mocked(reanimateAgent).mockImplementation(() => {
      throw new ConnectError("Session not found: no-such", Code.NotFound);
    });

    const err = await handlers.resumeAgent({ sessionId: "no-such" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
    expect(err.message).toContain("no-such");
  });

  it("throws FailedPrecondition when session is already active", async () => {
    vi.mocked(reanimateAgent).mockImplementation(() => {
      throw new ConnectError("Session sess-1 is already active (status: idle)", Code.FailedPrecondition);
    });

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("already active");
  });

  it("throws FailedPrecondition when terminal session has no runtimeSessionId", async () => {
    vi.mocked(reanimateAgent).mockImplementation(() => {
      throw new ConnectError("Session sess-1 has no runtime session ID", Code.FailedPrecondition);
    });

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("no runtime session ID");
  });

  it("throws FailedPrecondition when another active session exists on the environment", async () => {
    vi.mocked(reanimateAgent).mockImplementation(() => {
      throw new ConnectError("Environment already has active session sess-other", Code.FailedPrecondition);
    });

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("already has active session");
  });

  it("throws FailedPrecondition when environment is offline (no connection)", async () => {
    vi.mocked(reanimateAgent).mockImplementation(() => {
      throw new ConnectError("Environment env-1 not connected", Code.FailedPrecondition);
    });

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("not connected");
  });

  it("reanimates a STOPPED session: calls reanimateAgent and returns session", async () => {
    const runningSession = makeSession({ status: "running", endedAt: null });
    vi.mocked(reanimateAgent).mockReturnValue(runningSession);

    const result = await handlers.resumeAgent({ sessionId: "sess-1" }) as grackle.Session;

    expect(reanimateAgent).toHaveBeenCalledWith("sess-1");
    expect(result.id).toBe("sess-1");
    expect(result.status).toBe("running");
  });

  it("reanimates a SUSPENDED session successfully", async () => {
    const runningSession = makeSession({ status: "running", error: null });
    vi.mocked(reanimateAgent).mockReturnValue(runningSession);

    const result = await handlers.resumeAgent({ sessionId: "sess-1" }) as grackle.Session;

    expect(reanimateAgent).toHaveBeenCalledWith("sess-1");
    expect(result.id).toBe("sess-1");
  });

  it("propagates FailedPrecondition from reanimateAgent when env not connected", async () => {
    vi.mocked(reanimateAgent).mockImplementation(() => {
      throw new ConnectError("Environment env-1 not connected", Code.FailedPrecondition);
    });

    const err = await handlers.resumeAgent({ sessionId: "sess-1" }).catch((e: unknown) => e) as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("not connected");
  });

  it("can reanimate a session a second time after it stops again", async () => {
    const runningSession = makeSession({ status: "running", endedAt: null });
    vi.mocked(reanimateAgent).mockReturnValue(runningSession);

    await handlers.resumeAgent({ sessionId: "sess-1" });
    await handlers.resumeAgent({ sessionId: "sess-1" });

    expect(reanimateAgent).toHaveBeenCalledTimes(2);
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

    expect(sessionStore.reanimateSession).toHaveBeenCalledWith("sess-1");
    expect(ensureLifecycleStream).toHaveBeenCalledWith("sess-1", "__server__");
    expect(processEventStream).toHaveBeenCalled();
    expect(result.id).toBe("sess-1");
  });
});
