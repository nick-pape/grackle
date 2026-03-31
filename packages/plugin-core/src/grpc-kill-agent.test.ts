/**
 * Unit tests for the gRPC killAgent handler.
 * Covers both hard kill (SIGKILL) and graceful kill (SIGTERM) paths,
 * including the bug fix for forwarding kills to PowerLine.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

// ── Mock heavy dependencies before importing the module ──────────

const { mockSendInputToSession } = vi.hoisted(() => ({
  mockSendInputToSession: vi.fn().mockResolvedValue(true),
}));

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
    streamRegistry: {
      getSubscriptionsForSession: vi.fn(() => []),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    },
    processEventStream: vi.fn(),
    recoverSuspendedSessions: vi.fn().mockResolvedValue(undefined),
    clearReconnectState: vi.fn(),
    cleanupLifecycleStream: vi.fn(),
    ensureLifecycleStream: vi.fn(),
    sendInputToSession: (...args: unknown[]) => mockSendInputToSession(...args),
    deliverSignalToTask: vi.fn(),
  };
});

vi.mock("@grackle-ai/prompt", () => ({
  SystemPromptBuilder: vi.fn().mockImplementation(() => ({ build: () => "" })),
  buildTaskPrompt: vi.fn((title: string) => title),
}));

vi.mock("./compute-task-status.js", () => ({
  computeTaskStatus: vi.fn(() => ({ status: "not_started", latestSessionId: "" })),
}));

vi.mock("./knowledge-init.js", () => ({
  initKnowledge: vi.fn(),
}));

vi.mock("./reanimate-agent.js", () => ({
  reanimateAgent: vi.fn(),
}));

vi.mock("./github-import.js", () => ({
  importGitHubIssues: vi.fn(),
}));

vi.mock("./pipe-delivery.js", () => ({
  deliverPipeMessage: vi.fn(),
}));

vi.mock("./utils/exec.js", () => ({
  execAsync: vi.fn(),
}));

vi.mock("./utils/network.js", () => ({
  findFreePort: vi.fn(),
}));

vi.mock("./utils/slugify.js", () => ({
  slugify: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-")),
}));

// ── Import AFTER mocks ──────────────────────────────────────────

import { registerGrackleRoutes } from "./grpc-service.js";
import { sessionStore } from "@grackle-ai/database";
import { adapterManager, streamRegistry, cleanupLifecycleStream, ensureLifecycleStream } from "@grackle-ai/core";
const lifecycle = { cleanupLifecycleStream, ensureLifecycleStream };
import type { ConnectRouter } from "@connectrpc/connect";

/**
 * Extract the service handlers from registerGrackleRoutes by
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

// ── Helpers ────────────────────────────────────────────────

const ACTIVE_SESSION = {
  id: "sess-1",
  environmentId: "env-1",
  status: "idle",
  runtime: "stub",
  runtimeSessionId: "rt-1",
  prompt: "",
  model: "claude",
  logPath: "/tmp/log",
  turns: 0,
  startedAt: new Date().toISOString(),
  suspendedAt: null,
  endedAt: null,
  endReason: null,
  error: null,
  taskId: "",
  personaId: "",
  parentSessionId: "",
  pipeMode: "",
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  sigtermSentAt: null,
};

function makeMockConnection(killMock = vi.fn().mockResolvedValue({})) {
  return {
    client: { kill: killMock, sendInput: vi.fn().mockResolvedValue({}) },
    environmentId: "env-1",
    port: 7433,
  };
}

// ── Tests ────────────────────────────────────────────────

describe("gRPC killAgent", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  it("throws NOT_FOUND when session does not exist", async () => {
    vi.mocked(sessionStore.getSession).mockReturnValue(undefined);

    const err = await handlers
      .killAgent({ id: "nonexistent", graceful: false })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe(Code.NotFound);
  });

  describe("graceful=false (hard kill / SIGKILL)", () => {
    it("sets status to stopped with endReason=killed", async () => {
      vi.mocked(sessionStore.getSession).mockReturnValue(ACTIVE_SESSION);

      await handlers.killAgent({ id: "sess-1", graceful: false });

      expect(sessionStore.updateSession).toHaveBeenCalledWith(
        "sess-1",
        "stopped",
        undefined,
        undefined,
        "killed",
      );
    });

    it("forwards kill to PowerLine via adapter connection", async () => {
      vi.mocked(sessionStore.getSession).mockReturnValue(ACTIVE_SESSION);
      const mockKill = vi.fn().mockResolvedValue({});
      const mockConn = makeMockConnection(mockKill);
      vi.mocked(adapterManager.getConnection).mockReturnValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockConn as any,
      );

      await handlers.killAgent({ id: "sess-1", graceful: false });

      expect(mockKill).toHaveBeenCalledOnce();
    });

    it("cleans up lifecycle streams and subscriptions", async () => {
      vi.mocked(sessionStore.getSession).mockReturnValue(ACTIVE_SESSION);

      await handlers.killAgent({ id: "sess-1", graceful: false });

      expect(lifecycle.cleanupLifecycleStream).toHaveBeenCalledWith("sess-1");
      expect(streamRegistry.getSubscriptionsForSession).toHaveBeenCalledWith("sess-1");
    });
  });

  describe("graceful=true (SIGTERM)", () => {
    it("delivers [SIGTERM] message via sendInputToSession", async () => {
      vi.mocked(sessionStore.getSession).mockReturnValue(ACTIVE_SESSION);
      mockSendInputToSession.mockResolvedValue(true);

      await handlers.killAgent({ id: "sess-1", graceful: true });

      expect(mockSendInputToSession).toHaveBeenCalledWith(
        "sess-1",
        "env-1",
        expect.stringContaining("[SIGTERM]"),
        "sigterm",
      );
    });

    it("records sigtermSentAt in the database", async () => {
      vi.mocked(sessionStore.getSession).mockReturnValue(ACTIVE_SESSION);
      mockSendInputToSession.mockResolvedValue(true);

      await handlers.killAgent({ id: "sess-1", graceful: true });

      expect(sessionStore.setSigtermSentAt).toHaveBeenCalledWith("sess-1");
    });

    it("does NOT set session status to stopped", async () => {
      vi.mocked(sessionStore.getSession).mockReturnValue(ACTIVE_SESSION);
      mockSendInputToSession.mockResolvedValue(true);

      await handlers.killAgent({ id: "sess-1", graceful: true });

      expect(sessionStore.updateSession).not.toHaveBeenCalled();
    });

    it("does NOT cleanup lifecycle streams", async () => {
      vi.mocked(sessionStore.getSession).mockReturnValue(ACTIVE_SESSION);
      mockSendInputToSession.mockResolvedValue(true);

      await handlers.killAgent({ id: "sess-1", graceful: true });

      expect(lifecycle.cleanupLifecycleStream).not.toHaveBeenCalled();
    });

    it("falls back to hard kill if signal delivery fails", async () => {
      vi.mocked(sessionStore.getSession).mockReturnValue(ACTIVE_SESSION);
      mockSendInputToSession.mockResolvedValue(false);

      await handlers.killAgent({ id: "sess-1", graceful: true });

      // Should have cleared the optimistic sigtermSentAt flag
      expect(sessionStore.clearSigtermSentAt).toHaveBeenCalledWith("sess-1");
      // Should have fallen through to hard kill
      expect(sessionStore.updateSession).toHaveBeenCalledWith(
        "sess-1",
        "stopped",
        undefined,
        undefined,
        "killed",
      );
    });
  });
});
