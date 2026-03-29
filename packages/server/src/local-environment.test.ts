import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROOT_TASK_ID, DEFAULT_WORKSPACE_ID } from "@grackle-ai/common";
import { bootstrapLocalEnvironment, type LocalEnvironmentDeps } from "./local-environment.js";

/** Minimal environment row shape for testing. */
function makeEnvRow(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "local",
    name: "Local",
    adapterType: "local",
    adapterConfig: JSON.stringify({ port: 7433, host: "127.0.0.1" }),
    status: "disconnected",
    powerlineToken: "test-token",
    defaultRuntime: "claude-code",
    bootstrapped: false,
    ...overrides,
  };
}

/** Build a full mock deps object with sensible defaults. */
function createMockDeps(overrides?: Partial<LocalEnvironmentDeps>): LocalEnvironmentDeps {
  const envRow = makeEnvRow();
  const mockManager = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };

  return {
    envRegistry: {
      getEnvironment: vi.fn(() => envRow),
      updateAdapterConfig: vi.fn(),
      addEnvironment: vi.fn(),
      updateEnvironmentStatus: vi.fn(),
      markBootstrapped: vi.fn(),
      updateDefaultRuntime: vi.fn(),
    },
    settingsStore: {
      getSetting: vi.fn(() => undefined),
    },
    personaStore: {
      getPersona: vi.fn(() => undefined),
    },
    workspaceStore: {
      getWorkspace: vi.fn(() => ({ id: DEFAULT_WORKSPACE_ID, environmentId: "local" })),
      createWorkspace: vi.fn(),
    },
    taskStore: {
      getTask: vi.fn(() => ({ id: ROOT_TASK_ID, workspaceId: DEFAULT_WORKSPACE_ID })),
      setTaskWorkspace: vi.fn(),
    },
    getAdapter: vi.fn(() => ({
      connect: vi.fn(async () => ({ close: vi.fn() })),
    })),
    parseAdapterConfig: vi.fn(() => ({ port: 7433, host: "127.0.0.1" })),
    setConnection: vi.fn(),
    pushToEnv: vi.fn(async () => {}),
    reconnectOrProvision: vi.fn(async function* () {}),
    emit: vi.fn(),
    resetReconnectState: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    createPowerLineManager: vi.fn(() => mockManager),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bootstrapLocalEnvironment", () => {
  // ── Skip path ──────────────────────────

  describe("when skipLocalPowerline is true", () => {
    it("returns empty result and logs skip message", async () => {
      const deps = createMockDeps();
      const result = await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: true },
        deps,
      );
      expect(result.powerLineManager).toBeUndefined();
      expect(deps.logger.info).toHaveBeenCalledWith(
        "Skipping local PowerLine auto-start (GRACKLE_SKIP_LOCAL_POWERLINE=1)",
      );
    });
  });

  // ── Environment creation/update ──────────────────────────

  describe("environment creation and update", () => {
    it("creates local env if it does not exist", async () => {
      const deps = createMockDeps();
      (deps.envRegistry.getEnvironment as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(undefined) // first call: doesn't exist
        .mockReturnValue(makeEnvRow());  // subsequent calls: exists after creation

      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.envRegistry.addEnvironment).toHaveBeenCalledWith(
        "local", "Local", "local",
        JSON.stringify({ port: 7433, host: "127.0.0.1" }),
      );
    });

    it("updates adapter config if local env already exists", async () => {
      const deps = createMockDeps();
      await bootstrapLocalEnvironment(
        { powerlinePort: 9000, bindHost: "0.0.0.0", skipLocalPowerline: false },
        deps,
      );
      expect(deps.envRegistry.updateAdapterConfig).toHaveBeenCalledWith(
        "local",
        JSON.stringify({ port: 9000, host: "0.0.0.0" }),
      );
    });

    it("adapter config JSON includes port and host from options", async () => {
      const deps = createMockDeps();
      await bootstrapLocalEnvironment(
        { powerlinePort: 8000, bindHost: "192.168.1.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.envRegistry.updateAdapterConfig).toHaveBeenCalledWith(
        "local",
        JSON.stringify({ port: 8000, host: "192.168.1.1" }),
      );
    });
  });

  // ── Runtime sync ──────────────────────────

  describe("runtime sync with default persona", () => {
    it("syncs runtime when persona has different runtime", async () => {
      const deps = createMockDeps();
      (deps.settingsStore.getSetting as ReturnType<typeof vi.fn>).mockReturnValue("persona-1");
      (deps.personaStore.getPersona as ReturnType<typeof vi.fn>).mockReturnValue({ runtime: "copilot" });

      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.envRegistry.updateDefaultRuntime).toHaveBeenCalledWith("local", "copilot");
    });

    it("does not sync runtime when runtimes already match", async () => {
      const deps = createMockDeps();
      (deps.settingsStore.getSetting as ReturnType<typeof vi.fn>).mockReturnValue("persona-1");
      (deps.personaStore.getPersona as ReturnType<typeof vi.fn>).mockReturnValue({ runtime: "claude-code" });

      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.envRegistry.updateDefaultRuntime).not.toHaveBeenCalled();
    });

    it("does not sync runtime when no default persona exists", async () => {
      const deps = createMockDeps();
      (deps.settingsStore.getSetting as ReturnType<typeof vi.fn>).mockReturnValue("");

      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.envRegistry.updateDefaultRuntime).not.toHaveBeenCalled();
    });
  });

  // ── Workspace seeding ──────────────────────────

  describe("workspace seeding", () => {
    it("creates default workspace if missing", async () => {
      const deps = createMockDeps();
      (deps.workspaceStore.getWorkspace as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.workspaceStore.createWorkspace).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID, "Default", "", "", "local", false,
      );
    });

    it("does not recreate workspace if it exists", async () => {
      const deps = createMockDeps();
      // getWorkspace returns a workspace by default
      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.workspaceStore.createWorkspace).not.toHaveBeenCalled();
    });

    it("warns if default workspace is on non-local env", async () => {
      const deps = createMockDeps();
      (deps.workspaceStore.getWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
        id: DEFAULT_WORKSPACE_ID,
        environmentId: "remote-ssh",
      });

      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.logger.warn).toHaveBeenCalledWith(
        { workspaceId: DEFAULT_WORKSPACE_ID, environmentId: "remote-ssh" },
        "Default workspace is not bound to local environment; skipping system task association",
      );
    });
  });

  // ── System task backfill ──────────────────────────

  describe("system task workspace backfill", () => {
    it("assigns default workspace to system task if task has no workspace", async () => {
      const deps = createMockDeps();
      (deps.taskStore.getTask as ReturnType<typeof vi.fn>).mockReturnValue({
        id: ROOT_TASK_ID,
        workspaceId: undefined,
      });

      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.taskStore.setTaskWorkspace).toHaveBeenCalledWith(ROOT_TASK_ID, DEFAULT_WORKSPACE_ID);
    });

    it("does not backfill if system task already has a workspace", async () => {
      const deps = createMockDeps();
      // Default: task already has workspaceId
      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.taskStore.setTaskWorkspace).not.toHaveBeenCalled();
    });

    it("does not backfill if default workspace is on non-local env", async () => {
      const deps = createMockDeps();
      (deps.taskStore.getTask as ReturnType<typeof vi.fn>).mockReturnValue({
        id: ROOT_TASK_ID,
        workspaceId: undefined,
      });
      (deps.workspaceStore.getWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
        id: DEFAULT_WORKSPACE_ID,
        environmentId: "remote-ssh",
      });

      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.taskStore.setTaskWorkspace).not.toHaveBeenCalled();
    });
  });

  // ── PowerLine manager + connection ──────────────────────────

  describe("PowerLine manager and connection", () => {
    it("starts PowerLine manager and connects successfully", async () => {
      const deps = createMockDeps();
      const result = await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );

      expect(deps.createPowerLineManager).toHaveBeenCalledOnce();
      const manager = result.powerLineManager!;
      expect(manager.start).toHaveBeenCalledOnce();
      expect(deps.setConnection).toHaveBeenCalledWith("local", expect.anything());
      expect(deps.envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("local", "connected");
      expect(deps.envRegistry.markBootstrapped).toHaveBeenCalledWith("local");
    });

    it("iterates all reconnectOrProvision events", async () => {
      const events = [
        { stage: "bootstrap", progress: 50, message: "Installing..." },
        { stage: "bootstrap", progress: 100, message: "Done" },
      ];
      const deps = createMockDeps({
        reconnectOrProvision: vi.fn(async function* () {
          for (const e of events) {
            yield e;
          }
        }),
      });

      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.logger.info).toHaveBeenCalledWith(
        { stage: "bootstrap", progress: 50 },
        "Local env: %s",
        "Installing...",
      );
      expect(deps.logger.info).toHaveBeenCalledWith(
        { stage: "bootstrap", progress: 100 },
        "Local env: %s",
        "Done",
      );
    });

    it("pushes to env excluding file tokens", async () => {
      const deps = createMockDeps();
      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );
      expect(deps.pushToEnv).toHaveBeenCalledWith("local", { excludeFileTokens: true });
    });

    it("sets status to connecting before provision", async () => {
      const deps = createMockDeps();
      await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );

      const statusCalls = (deps.envRegistry.updateEnvironmentStatus as ReturnType<typeof vi.fn>).mock.calls;
      const connectingIdx = statusCalls.findIndex(
        (c: string[]) => c[0] === "local" && c[1] === "connecting",
      );
      const connectedIdx = statusCalls.findIndex(
        (c: string[]) => c[0] === "local" && c[1] === "connected",
      );
      expect(connectingIdx).toBeGreaterThanOrEqual(0);
      expect(connectedIdx).toBeGreaterThan(connectingIdx);
    });
  });

  // ── Error handling ──────────────────────────

  describe("error handling", () => {
    it("cleans up manager and sets error status on failure", async () => {
      const mockManager = {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
      };
      const deps = createMockDeps({
        createPowerLineManager: vi.fn(() => mockManager),
        // Make reconnectOrProvision throw
        reconnectOrProvision: vi.fn(async function* () {
          throw new Error("provision failed");
        }),
      });

      const result = await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );

      expect(mockManager.stop).toHaveBeenCalledOnce();
      expect(deps.envRegistry.updateEnvironmentStatus).toHaveBeenCalledWith("local", "error");
      expect(result.powerLineManager).toBeUndefined();
    });

    it("logs warning and continues if manager.stop() throws during cleanup", async () => {
      const mockManager = {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => { throw new Error("stop failed"); }),
      };
      const deps = createMockDeps({
        createPowerLineManager: vi.fn(() => mockManager),
        reconnectOrProvision: vi.fn(async function* () {
          throw new Error("provision failed");
        }),
      });

      const result = await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );

      // Should not throw — cleanup failure is caught
      expect(result.powerLineManager).toBeUndefined();
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("Failed to stop local PowerLine during cleanup"),
      );
    });

    it("returns undefined manager on failure (non-fatal, does not throw)", async () => {
      const deps = createMockDeps({
        getAdapter: vi.fn(() => {
          throw new Error("adapter not found");
        }),
      });

      const result = await bootstrapLocalEnvironment(
        { powerlinePort: 7433, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );

      // Does not throw, returns gracefully
      expect(result.powerLineManager).toBeUndefined();
      expect(deps.logger.error).toHaveBeenCalled();
    });

    it("logs the error with port information", async () => {
      const deps = createMockDeps({
        getAdapter: vi.fn(() => { throw new Error("boom"); }),
      });

      await bootstrapLocalEnvironment(
        { powerlinePort: 9999, bindHost: "127.0.0.1", skipLocalPowerline: false },
        deps,
      );

      expect(deps.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), port: 9999 }),
        expect.stringContaining("Failed to start local PowerLine"),
        9999,
      );
    });
  });
});
