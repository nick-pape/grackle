/**
 * Unit tests for the gRPC sendInput handler error paths.
 * Replaces the deleted ws-bridge-send-input tests, covering:
 * missing session, terminal session, and disconnected environment.
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
      ensureLogInitialized: vi.fn(),
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
    emit: vi.fn(),
    tokenPush: {
      pushToEnv: vi.fn(),
      pushProviderCredentialsToEnv: vi.fn(),
      refreshTokensForTask: vi.fn(),
      pushToAll: vi.fn(),
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
    ensureStdinStream: vi.fn(),
    publishToStdin: vi.fn(),
    processorRegistry: {
      get: vi.fn(() => undefined),
      lateBind: vi.fn(),
    },
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

vi.mock("./github-import.js", () => ({
  importGitHubIssues: vi.fn(),
}));

// ── Import AFTER mocks ──────────────────────────────────────────

import { registerGrackleRoutes } from "./grpc-service.js";
import { sessionStore } from "@grackle-ai/database";
import { adapterManager, publishToStdin } from "@grackle-ai/core";
import type { ConnectRouter } from "@connectrpc/connect";

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

describe("gRPC sendInput", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  it("throws NOT_FOUND when session does not exist", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(undefined);

    const err = await handlers.sendInput({
      sessionId: "nonexistent",
      text: "hello",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.NotFound);
    expect(err.message).toContain("nonexistent");
  });

  it("throws FAILED_PRECONDITION when session is stopped", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue({
      id: "sess-1",
      environmentId: "env-1",
      runtime: "claude-code",
      runtimeSessionId: "rt-1",
      prompt: "",
      model: "claude-sonnet-4-20250514",
      status: "stopped",
      logPath: "/logs/sess-1",
      turns: 0,
      startedAt: "2026-01-01T00:00:00Z",
      suspendedAt: null,
      endedAt: null,
      error: null,
      taskId: "",
      personaId: "",
    });

    const err = await handlers.sendInput({
      sessionId: "sess-1",
      text: "hello",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("has ended");
  });

  it("throws FAILED_PRECONDITION when environment is not connected", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue({
      id: "sess-1",
      environmentId: "env-1",
      runtime: "claude-code",
      runtimeSessionId: "rt-1",
      prompt: "",
      model: "claude-sonnet-4-20250514",
      status: "running",
      logPath: "/logs/sess-1",
      turns: 0,
      startedAt: "2026-01-01T00:00:00Z",
      suspendedAt: null,
      endedAt: null,
      error: null,
      taskId: "",
      personaId: "",
    });
    vi.mocked(adapterManager.getConnection).mockReturnValue(undefined);

    const err = await handlers.sendInput({
      sessionId: "sess-1",
      text: "hello",
    }).catch((e: unknown) => e) as ConnectError;

    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.message).toContain("not connected");
  });

  it("succeeds when session is running and environment is connected", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue({
      id: "sess-1",
      environmentId: "env-1",
      runtime: "claude-code",
      runtimeSessionId: "rt-1",
      prompt: "",
      model: "claude-sonnet-4-20250514",
      status: "running",
      logPath: "/logs/sess-1",
      turns: 0,
      startedAt: "2026-01-01T00:00:00Z",
      suspendedAt: null,
      endedAt: null,
      error: null,
      taskId: "",
      personaId: "",
    });
    vi.mocked(adapterManager.getConnection).mockReturnValue({
      client: { sendInput: vi.fn().mockResolvedValue({}) } as never,
    } as never);

    const result = await handlers.sendInput({
      sessionId: "sess-1",
      text: "hello world",
    });

    expect(result).toBeDefined();
    // sendInput now routes through stdin stream instead of direct PowerLine call
    expect(publishToStdin).toHaveBeenCalledWith("sess-1", "hello world");
  });
});
