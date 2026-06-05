import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProvisionEvent } from "./adapter.js";
import type { RemoteExecutor } from "./remote-executor.js";
import type { ProcessTunnel } from "./tunnel.js";
import type { PowerLineConnection } from "./adapter.js";
import type { RemoteTunnelConfig, RemoteTunnelMeta } from "./remote-tunnel-adapter.js";
import { RemoteTunnelAdapter } from "./remote-tunnel-adapter.js";
import { FatalAdapterError } from "./fatal-error.js";

// ── Test Config ─────────────────────────────────────────────

interface TestConfig extends RemoteTunnelConfig {
  target: string;
}

// ── Mock Tunnel ─────────────────────────────────────────────

interface MockTunnelInstance {
  localPort: number;
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

let tunnelInstances: MockTunnelInstance[] = [];
let tunnelOpenCallCount: number = 0;
let tunnelOpenFailOnCall: number = -1;

function createMockTunnel(localPort: number): MockTunnelInstance {
  const instance: MockTunnelInstance = {
    localPort,
    open: vi.fn().mockImplementation(async () => {
      tunnelOpenCallCount++;
      if (tunnelOpenCallCount === tunnelOpenFailOnCall) {
        throw new Error("tunnel open failed");
      }
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  tunnelInstances.push(instance);
  return instance;
}

// ── Test Adapter ────────────────────────────────────────────

class TestAdapter extends RemoteTunnelAdapter<TestConfig> {
  public type: string = "test";

  protected resolveConfig(config: Record<string, unknown>): {
    config: TestConfig;
    meta: RemoteTunnelMeta;
  } {
    const cfg = config as unknown as TestConfig;
    if (!cfg.target) {
      throw new Error("Test adapter requires a 'target'");
    }
    return { config: cfg, meta: { displayTarget: cfg.target } };
  }

  protected createExecutor(_cfg: TestConfig): RemoteExecutor {
    return {
      exec: mockExec,
      copyTo: vi.fn().mockResolvedValue(undefined),
    };
  }

  protected createForwardTunnel(localPort: number, _cfg: TestConfig): ProcessTunnel {
    return createMockTunnel(localPort) as unknown as ProcessTunnel;
  }

  protected createReverseTunnel(
    localPort: number,
    _remotePort: number,
    _cfg: TestConfig,
  ): ProcessTunnel {
    return createMockTunnel(localPort) as unknown as ProcessTunnel;
  }
}

// ── Mocks ───────────────────────────────────────────────────

const mockExec = vi.fn().mockResolvedValue("");
const mockSleep = vi.fn().mockResolvedValue(undefined);

/** Collect all events from an async generator. */
async function collectEvents(gen: AsyncGenerator<ProvisionEvent>): Promise<ProvisionEvent[]> {
  const events: ProvisionEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ── Tests ───────────────────────────────────────────────────

describe("RemoteTunnelAdapter", () => {
  let adapter: TestAdapter;
  const config: Record<string, unknown> = { target: "test-host" };
  const token: string = "test-token";
  const envId: string = "env-test-1";

  beforeEach(() => {
    vi.clearAllMocks();
    tunnelInstances = [];
    tunnelOpenCallCount = 0;
    tunnelOpenFailOnCall = -1;
    mockExec.mockResolvedValue("");

    adapter = new TestAdapter({
      exec: mockExec,
      sleep: mockSleep,
    });

    // Mock the SDK wrapper methods to avoid real I/O
    vi.spyOn(adapter as unknown as Record<string, unknown>, "runBootstrap").mockImplementation(
      async function* (): AsyncGenerator<ProvisionEvent> {
        yield { stage: "bootstrapping", message: "mock bootstrap", progress: 0.5 };
      },
    );
    vi.spyOn(adapter as unknown as Record<string, unknown>, "runStartPowerLine").mockResolvedValue({
      alreadyRunning: true,
    });
    vi.spyOn(adapter as unknown as Record<string, unknown>, "openWithFreePort").mockImplementation(
      async (action: (port: number) => Promise<unknown>) => action(9999),
    );
    vi.spyOn(
      adapter as unknown as Record<string, unknown>,
      "closeTunnelForEnvironment",
    ).mockResolvedValue(undefined);
    vi.spyOn(
      adapter as unknown as Record<string, unknown>,
      "registerTunnelForEnvironment",
    ).mockImplementation(() => {});
  });

  // ── Provision ──────────────────────────────────────────────

  describe("provision()", () => {
    it("yields progress events through the full lifecycle", async () => {
      const events = await collectEvents(adapter.provision(envId, config, token));

      expect(events.length).toBeGreaterThanOrEqual(4);
      expect(events[0]!.stage).toBe("connecting");
      expect(events[0]!.message).toContain("test-host");
    });

    it("calls runBootstrap with correct options", async () => {
      const cfgWithEnv: Record<string, unknown> = {
        target: "test-host",
        env: { MY_VAR: "val" },
        defaultRuntime: "claude-code",
      };
      await collectEvents(adapter.provision(envId, cfgWithEnv, token));

      const bootstrapSpy = adapter["runBootstrap"] as unknown as ReturnType<typeof vi.fn>;
      expect(bootstrapSpy).toHaveBeenCalledOnce();
      const options = bootstrapSpy.mock.calls[0]![2];
      expect(options.extraEnv).toEqual({ MY_VAR: "val" });
      expect(options.defaultRuntime).toBe("claude-code");
    });

    it("opens forward and reverse tunnels and registers them", async () => {
      await collectEvents(adapter.provision(envId, config, token));

      expect(tunnelInstances).toHaveLength(2);
      expect(tunnelInstances[0]!.open).toHaveBeenCalledOnce();
      expect(tunnelInstances[1]!.open).toHaveBeenCalledOnce();
      const registerSpy = adapter["registerTunnelForEnvironment"] as unknown as ReturnType<
        typeof vi.fn
      >;
      expect(registerSpy).toHaveBeenCalledWith(
        envId,
        expect.objectContaining({
          tunnel: expect.objectContaining({ localPort: 9999 }),
        }),
      );
    });

    it("throws if config validation fails", async () => {
      await expect(collectEvents(adapter.provision(envId, {}, token))).rejects.toThrow("target");
    });

    it("passes through FatalAdapterError from connectivity test", async () => {
      mockExec.mockRejectedValueOnce(new FatalAdapterError("codespace deleted"));

      await expect(collectEvents(adapter.provision(envId, config, token))).rejects.toThrow(
        FatalAdapterError,
      );
    });

    it("wraps non-fatal connectivity errors with displayTarget", async () => {
      mockExec.mockRejectedValueOnce(new Error("connection refused"));

      await expect(collectEvents(adapter.provision(envId, config, token))).rejects.toThrow(
        "Cannot reach test-host",
      );
    });

    it("closes forward tunnel when reverse tunnel open() fails", async () => {
      tunnelOpenFailOnCall = 2;

      await expect(collectEvents(adapter.provision(envId, config, token))).rejects.toThrow(
        "tunnel open failed",
      );

      expect(tunnelInstances).toHaveLength(2);
      expect(tunnelInstances[0]!.close).toHaveBeenCalledOnce();
      const registerSpy = adapter["registerTunnelForEnvironment"] as unknown as ReturnType<
        typeof vi.fn
      >;
      expect(registerSpy).not.toHaveBeenCalled();
    });

    it("uses configured localPort when specified", async () => {
      const cfgWithPort: Record<string, unknown> = { target: "test-host", localPort: 12345 };
      await collectEvents(adapter.provision(envId, cfgWithPort, token));

      const freePortSpy = adapter["openWithFreePort"] as unknown as ReturnType<typeof vi.fn>;
      expect(freePortSpy).not.toHaveBeenCalled();
      expect(tunnelInstances[0]!.localPort).toBe(12345);
    });

    it("calls preBootstrap hook before bootstrap", async () => {
      const preBootstrapSpy = vi
        .spyOn(adapter as unknown as Record<string, unknown>, "preBootstrap")
        .mockResolvedValue({ workingDirectory: "/workspaces/test" });

      await collectEvents(adapter.provision(envId, config, token));

      expect(preBootstrapSpy).toHaveBeenCalledOnce();
      const bootstrapSpy = adapter["runBootstrap"] as unknown as ReturnType<typeof vi.fn>;
      const options = bootstrapSpy.mock.calls[0]![2];
      expect(options.workingDirectory).toBe("/workspaces/test");
    });
  });

  // ── Reconnect ──────────────────────────────────────────────

  describe("reconnect()", () => {
    it("yields reconnecting progress events on happy path", async () => {
      const events = await collectEvents(adapter.reconnect!(envId, config, token));

      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events.every((e) => e.stage === "reconnecting")).toBe(true);
      expect(events[events.length - 1]!.message).toContain("Reconnected");
    });

    it("closes stale tunnel and calls runStartPowerLine with probeFirst", async () => {
      await collectEvents(adapter.reconnect!(envId, config, token));

      const closeSpy = adapter["closeTunnelForEnvironment"] as unknown as ReturnType<typeof vi.fn>;
      expect(closeSpy).toHaveBeenCalledWith(envId);

      const startSpy = adapter["runStartPowerLine"] as unknown as ReturnType<typeof vi.fn>;
      expect(startSpy).toHaveBeenCalledOnce();
      const options = startSpy.mock.calls[0]![2];
      expect(options).toMatchObject({ probeFirst: true });
    });

    it("yields 'restarted' event when PowerLine was not already running", async () => {
      (adapter["runStartPowerLine"] as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        alreadyRunning: false,
      });

      const events = await collectEvents(adapter.reconnect!(envId, config, token));

      expect(events.some((e) => e.message.includes("restarted"))).toBe(true);
    });

    it("does not yield 'restarted' event when PowerLine was already running", async () => {
      const events = await collectEvents(adapter.reconnect!(envId, config, token));

      expect(events.some((e) => e.message.includes("restarted"))).toBe(false);
    });

    it("propagates error when runStartPowerLine fails", async () => {
      (adapter["runStartPowerLine"] as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("PowerLine process died"),
      );

      await expect(collectEvents(adapter.reconnect!(envId, config, token))).rejects.toThrow(
        "PowerLine process died",
      );
    });

    it("throws if config validation fails", async () => {
      await expect(collectEvents(adapter.reconnect!(envId, {}, token))).rejects.toThrow("target");
    });

    it("forwards extraEnv from config", async () => {
      const cfgWithEnv: Record<string, unknown> = {
        target: "test-host",
        env: { MY_VAR: "value" },
      };
      await collectEvents(adapter.reconnect!(envId, cfgWithEnv, token));

      const startSpy = adapter["runStartPowerLine"] as unknown as ReturnType<typeof vi.fn>;
      const options = startSpy.mock.calls[0]![2];
      expect(options.extraEnv).toEqual({ MY_VAR: "value" });
    });

    it("merges reconnectBootstrapOptions into startPowerLine call", async () => {
      vi.spyOn(
        adapter as unknown as Record<string, unknown>,
        "reconnectBootstrapOptions",
      ).mockReturnValue({
        autoDetectWorkspace: true,
      });

      await collectEvents(adapter.reconnect!(envId, config, token));

      const startSpy = adapter["runStartPowerLine"] as unknown as ReturnType<typeof vi.fn>;
      const options = startSpy.mock.calls[0]![2];
      expect(options.autoDetectWorkspace).toBe(true);
      expect(options.probeFirst).toBe(true);
    });

    it("closes forward tunnel when reverse tunnel open() fails", async () => {
      tunnelOpenFailOnCall = 2;

      await expect(collectEvents(adapter.reconnect!(envId, config, token))).rejects.toThrow(
        "tunnel open failed",
      );

      expect(tunnelInstances).toHaveLength(2);
      expect(tunnelInstances[0]!.close).toHaveBeenCalledOnce();
      const registerSpy = adapter["registerTunnelForEnvironment"] as unknown as ReturnType<
        typeof vi.fn
      >;
      expect(registerSpy).not.toHaveBeenCalled();
    });
  });
});
