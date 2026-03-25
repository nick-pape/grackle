/**
 * Unit tests for the gRPC killAgent handler.
 * Covers both hard kill (SIGKILL) and graceful kill (SIGTERM) paths,
 * including the bug fix for forwarding kills to PowerLine.
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

vi.mock("./lifecycle.js", () => ({
  cleanupLifecycleStream: vi.fn(),
  ensureLifecycleStream: vi.fn(),
}));

vi.mock("./stream-registry.js", () => ({
  getSubscriptionsForSession: vi.fn(() => []),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("./session-recovery.js", () => ({
  recoverSuspendedSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./auto-reconnect.js", () => ({
  clearReconnectState: vi.fn(),
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

const mockSendInputToSession = vi.fn().mockResolvedValue(true);
vi.mock("./signals/signal-delivery.js", () => ({
  sendInputToSession: (...args: unknown[]) => mockSendInputToSession(...args),
  deliverSignalToTask: vi.fn(),
}));

// ── Import AFTER mocks ──────────────────────────────────────────

import { registerGrackleRoutes } from "./grpc-service.js";
import { sessionStore } from "@grackle-ai/database";
import * as adapterManager from "./adapter-manager.js";
import * as lifecycle from "./lifecycle.js";
import * as streamRegistry from "./stream-registry.js";
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
