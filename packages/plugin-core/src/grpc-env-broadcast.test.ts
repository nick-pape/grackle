/**
 * Unit tests verifying that gRPC environment lifecycle methods
 * (provision, stop, destroy) broadcast environment updates to
 * WebSocket clients after each status transition.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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
  };
});

vi.mock("@grackle-ai/adapter-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@grackle-ai/adapter-sdk")>()),
  reconnectOrProvision: vi.fn(async function* () {}),
}));

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

// Import AFTER mocks — use the mocked versions
import { registerGrackleRoutes } from "./grpc-service.js";
import { emit, adapterManager } from "@grackle-ai/core";
import { envRegistry } from "@grackle-ai/database";
import type { ConnectRouter } from "@connectrpc/connect";

/** Fake environment row returned by getEnvironment. */
const FAKE_ENV = {
  id: "test-env",
  displayName: "Test Env",
  adapterType: "local",
  adapterConfig: "{}",
  bootstrapped: false,
  status: "disconnected",
  lastSeen: "",
  envInfo: "",
  createdAt: "2025-01-01",
  powerlineToken: "",
};

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

describe("gRPC environment broadcast", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = getHandlers();
  });

  describe("provisionEnvironment", () => {
    it("broadcasts after setting connecting status", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = {
        connect: vi.fn().mockRejectedValue(new Error("fail")),
        disconnect: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
      };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      const gen = handlers.provisionEnvironment({ id: "test-env" }) as AsyncGenerator;
      // Drain the generator
      for await (const _event of gen) { /* drain */ }

      // Should have broadcast after "connecting" and after "error"
      expect(emit).toHaveBeenCalledWith("environment.changed", {});
    });

    it("broadcasts after successful connection", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = {
        connect: vi.fn().mockResolvedValue({ client: {} }),
        disconnect: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
      };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      const gen = handlers.provisionEnvironment({ id: "test-env" }) as AsyncGenerator;
      // Drain the generator
      for await (const _event of gen) { /* drain */ }

      // "connecting" + "connected"
      expect(emit).toHaveBeenCalledWith("environment.changed", {});
      expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "connecting");
      expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "connected");
    });

    it("broadcasts after connection error", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = {
        connect: vi.fn().mockRejectedValue(new Error("timeout")),
        disconnect: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
      };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      const gen = handlers.provisionEnvironment({ id: "test-env" }) as AsyncGenerator;
      // Drain the generator
      for await (const _event of gen) { /* drain */ }

      expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "error");
      expect(emit).toHaveBeenCalledWith("environment.changed", {});
    });
  });

  describe("stopEnvironment", () => {
    it("broadcasts after setting disconnected status", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = { stop: vi.fn(), disconnect: vi.fn(), destroy: vi.fn() };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      await handlers.stopEnvironment({ id: "test-env" });

      expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "disconnected");
      expect(emit).toHaveBeenCalledWith("environment.changed", {});
    });
  });

  describe("destroyEnvironment", () => {
    it("broadcasts after setting disconnected status", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = { destroy: vi.fn(), disconnect: vi.fn(), stop: vi.fn() };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      await handlers.destroyEnvironment({ id: "test-env" });

      expect(envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("test-env", "disconnected");
      expect(emit).toHaveBeenCalledWith("environment.changed", {});
    });
  });

  describe("addEnvironment", () => {
    it("broadcasts after adding an environment", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);

      await handlers.addEnvironment({
        displayName: "Test Env",
        adapterType: "local",
        adapterConfig: "{}",

      });

      expect(envRegistry.addEnvironment).toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith("environment.changed", {});
    });
  });

  describe("removeEnvironment", () => {
    it("broadcasts after removing an environment", async () => {
      vi.mocked(envRegistry.getEnvironment).mockReturnValue(FAKE_ENV);
      const fakeAdapter = {
        disconnect: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
      };
      vi.mocked(adapterManager.getAdapter).mockReturnValue(fakeAdapter as never);

      await handlers.removeEnvironment({ id: "test-env" });

      expect(envRegistry.removeEnvironment).toHaveBeenCalledWith("test-env");
      expect(emit).toHaveBeenCalledWith("environment.changed", {});
    });
  });
});
