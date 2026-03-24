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

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("./log-writer.js", () => ({
  initLog: vi.fn(),
  writeEvent: vi.fn(),
  endSession: vi.fn(),
  readLog: vi.fn(() => []),
  ensureLogInitialized: vi.fn(),
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
  pushToAll: vi.fn(),
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

vi.mock("@grackle-ai/prompt", () => ({
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
import { sessionStore } from "@grackle-ai/database";
import * as adapterManager from "./adapter-manager.js";
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
    const mockSendInput = vi.fn().mockResolvedValue({});
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
      client: { sendInput: mockSendInput } as never,
    } as never);

    const result = await handlers.sendInput({
      sessionId: "sess-1",
      text: "hello world",
    });

    expect(result).toBeDefined();
    expect(mockSendInput).toHaveBeenCalledOnce();
  });
});
