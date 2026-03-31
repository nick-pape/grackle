/**
 * Unit tests for the gRPC getSession handler.
 * Verifies direct session lookup by ID and proper NOT_FOUND error.
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
    emit: vi.fn(),
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
import { sessionStore } from "@grackle-ai/database";
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
