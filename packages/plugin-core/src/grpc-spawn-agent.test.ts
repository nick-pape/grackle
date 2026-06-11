/**
 * Unit tests for the spawnAgent gRPC handler.
 *
 * Tests the logic AFTER the connection is established: credential push
 * (fail-fast pre-flight), persona resolution cascade, session row creation,
 * and handler response. The auto-provision path is covered separately in
 * spawn-auto-provision.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PreconditionError } from "@grackle-ai/common";

// ── Mock heavy dependencies before importing the module ──────────

vi.mock("@grackle-ai/database", async () => {
  const { createDatabaseMock } = await import("@grackle-ai/test-utils");
  const mock = createDatabaseMock();
  mock.wire();
  return mock;
});

vi.mock("@grackle-ai/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
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
      authenticateForRuntime: vi.fn().mockResolvedValue(undefined),
    },
    adapterManager: {
      getAdapter: vi.fn(),
      getConnection: vi.fn(() => undefined),
      setConnection: vi.fn(),
      removeConnection: vi.fn(),
      registerAdapter: vi.fn(),
      startHeartbeat: vi.fn(),
    },
    isReconnecting: vi.fn(() => false),
    streamRegistry: {
      getSubscriptionsForSession: vi.fn(() => []),
      subscribe: vi.fn(() => ({ fd: 0 })),
      unsubscribe: vi.fn(),
      createStream: vi.fn(() => {
        const iter = (async function* () {})();
        return Object.assign(iter, { id: "stream-1", cancel: vi.fn() });
      }),
    },
    processEventStream: vi.fn(),
    clearReconnectState: vi.fn(),
    recoverSuspendedSessions: vi.fn().mockResolvedValue(undefined),
    cleanupLifecycleStream: vi.fn(),
    ensureLifecycleStream: vi.fn(),
    ensureStdinStream: vi.fn(),
    pipeDelivery: {
      ensureAsyncDeliveryListener: vi.fn(),
    },
    getTraceId: vi.fn(() => "trace-123"),
  };
});

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  reconnectOrProvision: vi.fn(async function* () {}),
}));

vi.mock("@grackle-ai/auth", () => ({
  createScopedToken: vi.fn(() => "mock-scoped-token"),
  loadOrCreateApiKey: vi.fn(() => "mock-api-key"),
}));

vi.mock("@grackle-ai/prompt", () => ({
  resolvePersona: vi.fn(() => ({
    type: "default",
    personaId: "",
    systemPrompt: "",
    mcpServers: [],
    script: "",
  })),
  SystemPromptBuilder: vi.fn(function () {
    return { build: () => "" };
  }),
  buildTaskPrompt: vi.fn((title: string) => title),
  buildOrchestratorContext: vi.fn(() => ""),
}));

// Mock spawn-orchestration to control ensureSpawnConnection and the spawn tail
vi.mock("./spawn-orchestration.js", () => ({
  ensureSpawnConnection: vi.fn(),
  buildMcpUrl: vi.fn(() => "http://127.0.0.1:7435/mcp"),
  executeSpawnTail: vi.fn(() => ({ id: "sess-123", environmentId: "test-env" })),
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

vi.mock("./utils/format-gh-error.js", () => ({
  formatGhError: vi.fn((e: unknown) => String(e)),
}));

// ── Import AFTER mocks ────────────────────────────────────────────

import { registerGrackleRoutes } from "./grpc-service.js";
import { envRegistry, sessionStore, settingsStore } from "@grackle-ai/database";
import { tokenPush } from "@grackle-ai/core";
import { resolvePersona } from "@grackle-ai/prompt";
import { ensureSpawnConnection, executeSpawnTail } from "./spawn-orchestration.js";
import type { ConnectRouter } from "@connectrpc/connect";
import type { EnvironmentRow } from "@grackle-ai/database";
import type { PowerLineConnection } from "@grackle-ai/adapter-sdk";

/** Default resolved persona returned by resolvePersona mock. */
const FAKE_RESOLVED_PERSONA = {
  type: "default" as const,
  personaId: "",
  systemPrompt: "",
  mcpServers: [],
  script: "",
};

/** Fake environment row for tests. */
const FAKE_ENV: EnvironmentRow = {
  id: "test-env",
  displayName: "Test Env",
  adapterType: "local",
  adapterConfig: "{}",
  bootstrapped: true,
  status: "connected",
  lastSeen: "",
  envInfo: "",
  createdAt: "2025-01-01",
  powerlineToken: "tok-abc",
  githubAccountId: null,
  powerlineVersion: null,
};

/** Fake non-local environment row (for token exclusion test). */
const FAKE_SSH_ENV: EnvironmentRow = {
  ...FAKE_ENV,
  id: "ssh-env",
  adapterType: "ssh",
};

/** Fake connection returned by ensureSpawnConnection. */
const FAKE_CONN: Partial<PowerLineConnection> = {
  environmentId: "test-env",
  transport: {
    createSession: vi.fn(() => ({ stream: (async function* () {})() })),
    reanimate: vi.fn(),
  } as never,
  ping: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

/** Extract gRPC handler implementations from the service registry. */
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

describe("gRPC spawnAgent handler", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set mocks that individual tests may override (vi.clearAllMocks does not
    // reset implementations — only call history — so we restore defaults here).
    vi.mocked(tokenPush.authenticateForRuntime).mockResolvedValue(undefined);
    vi.mocked(resolvePersona).mockReturnValue(FAKE_RESOLVED_PERSONA);
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
    vi.mocked(ensureSpawnConnection).mockResolvedValue(FAKE_CONN as PowerLineConnection);
    vi.mocked(sessionStore.getSession).mockReturnValue({
      id: "sess-123",
      environmentId: "test-env",
      runtime: "claude-code",
      prompt: "hello",
      model: "",
      status: "idle",
      logPath: "/tmp/test-grackle/logs/sess-123",
      taskId: "",
      personaId: "",
      parentSessionId: "",
      pipeMode: "",
      inputTokens: 0,
      outputTokens: 0,
      costMillicents: 0,
      turns: 0,
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
      sigtermSentAt: null,
      runtimeSessionId: null,
    } as never);
    handlers = getHandlers();
  });

  // ── Credential push (fail-fast pre-flight) ──────────────────────

  it("throws before creating session when credential push fails", async () => {
    vi.mocked(tokenPush.authenticateForRuntime).mockRejectedValue(new Error("missing API key"));

    await expect(
      handlers.spawnAgent({ environmentId: "test-env", prompt: "hello" }),
    ).rejects.toThrow("missing API key");

    expect(sessionStore.createSession).not.toHaveBeenCalled();
  });

  it("passes excludeFileTokens:true for local adapter type", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV); // adapterType: "local"

    await handlers.spawnAgent({ environmentId: "test-env", prompt: "hello" });

    expect(tokenPush.authenticateForRuntime).toHaveBeenCalledWith("test-env", expect.any(String), {
      excludeFileTokens: true,
    });
  });

  it("passes undefined options for non-local adapter type", async () => {
    vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_SSH_ENV);
    vi.mocked(ensureSpawnConnection).mockResolvedValue({
      ...FAKE_CONN,
      environmentId: "ssh-env",
    } as PowerLineConnection);

    await handlers.spawnAgent({ environmentId: "ssh-env", prompt: "hello" });

    expect(tokenPush.authenticateForRuntime).toHaveBeenCalledWith(
      "ssh-env",
      expect.any(String),
      undefined,
    );
  });

  // ── Persona resolution ──────────────────────────────────────────

  it("throws PreconditionError when persona resolution fails", async () => {
    vi.mocked(resolvePersona).mockImplementation(() => {
      throw new Error("persona not found");
    });

    await expect(
      handlers.spawnAgent({ environmentId: "test-env", prompt: "hello" }),
    ).rejects.toBeInstanceOf(PreconditionError);

    expect(sessionStore.createSession).not.toHaveBeenCalled();
  });

  it("threads the app-default persona id through resolvePersona when request omits it", async () => {
    vi.mocked(settingsStore.getSetting).mockReturnValue("default-persona-id");

    await handlers.spawnAgent({ environmentId: "test-env", prompt: "hello" });

    expect(resolvePersona).toHaveBeenCalledWith(
      "", // request persona id — empty
      undefined,
      undefined,
      "default-persona-id",
      expect.any(Function),
    );
  });

  it("prefers the explicit persona id from the request over the app default", async () => {
    vi.mocked(settingsStore.getSetting).mockReturnValue("app-default");

    await handlers.spawnAgent({
      environmentId: "test-env",
      prompt: "hello",
      config: { personaId: "explicit-persona" },
    });

    expect(resolvePersona).toHaveBeenCalledWith(
      "explicit-persona",
      undefined,
      undefined,
      "app-default",
      expect.any(Function),
    );
  });

  // ── Happy path — session creation ──────────────────────────────

  it("creates a session row and calls executeSpawnTail on success", async () => {
    await handlers.spawnAgent({ environmentId: "test-env", prompt: "say hello" });

    expect(sessionStore.createSession).toHaveBeenCalledOnce();
    const createArgs = vi.mocked(sessionStore.createSession).mock.calls[0];
    expect(createArgs[1]).toBe("test-env"); // environmentId
    expect(createArgs[3]).toBe("say hello"); // prompt

    expect(executeSpawnTail).toHaveBeenCalledOnce();
  });

  it("returns the session proto built by executeSpawnTail", async () => {
    vi.mocked(executeSpawnTail).mockReturnValue({ id: "sess-xyz" } as never);

    const result = await handlers.spawnAgent({ environmentId: "test-env", prompt: "hello" });

    expect((result as { id: string }).id).toBe("sess-xyz");
  });
});
