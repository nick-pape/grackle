import type { PowerLineConnection, ProvisionEvent } from "./adapter.js";
import type { AdapterDependencies, ExecFunction } from "./adapter-dependencies.js";
import type { BootstrapOptions, StartRemotePowerLineOptions } from "./bootstrap.js";
import type { RemoteExecutor } from "./remote-executor.js";
import type { ProcessTunnel } from "./tunnel.js";
import type { TunnelState } from "./tunnel-registry.js";
import type { BaseEnvironmentConfig } from "./adapter.js";
import { BaseAdapter } from "./base-adapter.js";
import { FatalAdapterError } from "./fatal-error.js";
import { DEFAULT_MCP_PORT } from "@grackle-ai/common";
import { bootstrapPowerLine, startRemotePowerLine } from "./bootstrap.js";
import { connectThroughTunnel } from "./connect.js";
import { registerTunnel, getTunnel, closeTunnel } from "./tunnel-registry.js";
import { remoteStop, remoteDestroy, remoteHealthCheck } from "./shared-operations.js";
import { sleep as defaultSleep, withFreePort, SSH_CONNECTIVITY_TIMEOUT_MS } from "./utils.js";
import { exec as defaultExec } from "./exec.js";

/** Parse `GRACKLE_MCP_PORT` env var, falling back to {@link DEFAULT_MCP_PORT} on missing or non-numeric values. */
function parseMcpPort(): number {
  const raw = process.env.GRACKLE_MCP_PORT;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  return DEFAULT_MCP_PORT;
}

// ─── Types ──────────────────────────────────────────────────

/** Configuration fields shared by all remote-tunnel-based adapters. */
export interface RemoteTunnelConfig extends BaseEnvironmentConfig {
  /** Override the local tunnel port (otherwise a free port is chosen). */
  localPort?: number;
  /** Additional environment variables forwarded to the remote PowerLine. */
  env?: Record<string, string>;
}

/** Display metadata returned by {@link RemoteTunnelAdapter.resolveConfig}. */
export interface RemoteTunnelMeta {
  /** Human-readable target name for progress messages (e.g. "my-host", "codespace 'abc'"). */
  displayTarget: string;
}

// ─── Base Class ─────────────────────────────────────────────

/**
 * Abstract base for adapters that connect to a remote host via a process-backed
 * tunnel (SSH, gh codespace ports forward, etc.).
 *
 * Implements the full provision/reconnect/connect/disconnect/stop/destroy/healthCheck
 * lifecycle once. Subclasses provide four factory methods that encapsulate the
 * transport-specific differences (executor commands, tunnel arguments).
 *
 * @typeParam TConfig - Adapter-specific configuration extending {@link RemoteTunnelConfig}.
 */
export abstract class RemoteTunnelAdapter<
  TConfig extends RemoteTunnelConfig = RemoteTunnelConfig,
> extends BaseAdapter {
  protected readonly execFn: ExecFunction;
  protected readonly sleepFn: (ms: number) => Promise<void>;
  protected readonly isGitHubProviderEnabled: () => boolean;
  protected readonly resolveGitHubToken: (accountId?: string) => string | undefined;

  public constructor(deps: AdapterDependencies = {}) {
    super();
    this.execFn = deps.exec ?? defaultExec;
    this.sleepFn = deps.sleep ?? defaultSleep;
    this.isGitHubProviderEnabled = deps.isGitHubProviderEnabled ?? (() => false);
    this.resolveGitHubToken = deps.resolveGitHubToken ?? (() => undefined);
  }

  // ─── Abstract factories (subclasses MUST implement) ────────

  /**
   * Validate raw config and return typed config + display metadata.
   * Throw if required fields are missing.
   */
  protected abstract resolveConfig(config: Record<string, unknown>): {
    config: TConfig;
    meta: RemoteTunnelMeta;
  };

  /** Create a {@link RemoteExecutor} for running commands on the remote host. */
  protected abstract createExecutor(config: TConfig): RemoteExecutor;

  /** Create a forward tunnel (local port → remote PowerLine port). */
  protected abstract createForwardTunnel(localPort: number, config: TConfig): ProcessTunnel;

  /** Create a reverse tunnel (remote port → local MCP port). */
  protected abstract createReverseTunnel(
    localPort: number,
    remotePort: number,
    config: TConfig,
  ): ProcessTunnel;

  // ─── Optional hooks ────────────────────────────────────────

  /**
   * Post-connectivity hook called before bootstrap.
   * Override to detect the remote working directory (e.g. `/workspaces/*` on codespaces).
   * Default returns no working directory.
   */
  protected async preBootstrap(
    _executor: RemoteExecutor,
    _config: TConfig,
  ): Promise<{ workingDirectory?: string }> {
    return {};
  }

  /**
   * Additional options merged into {@link startRemotePowerLine} during reconnect.
   * Override to supply adapter-specific options (e.g. `{ autoDetectWorkspace: true }`).
   */
  protected reconnectBootstrapOptions(_config: TConfig): Record<string, unknown> {
    return {};
  }

  // ─── SDK operation wrappers ────────────────────────────────
  // Protected methods wrapping adapter-sdk functions. These provide a clean test
  // seam for subclass tests that mock via vi.spyOn, since the SDK functions
  // imported here are internal to adapter-sdk and not reachable through barrel mocks.

  /** Run the PowerLine bootstrap sequence on the remote host. */
  protected async *runBootstrap(
    executor: RemoteExecutor,
    powerlineToken: string,
    options: BootstrapOptions,
  ): AsyncGenerator<ProvisionEvent> {
    yield* bootstrapPowerLine(executor, powerlineToken, options);
  }

  /** Probe and optionally restart the remote PowerLine. */
  protected async runStartPowerLine(
    executor: RemoteExecutor,
    powerlineToken: string,
    options: StartRemotePowerLineOptions,
  ): Promise<{ alreadyRunning: boolean }> {
    return startRemotePowerLine(executor, powerlineToken, options);
  }

  /** Open a tunnel with automatic free-port discovery. */
  protected async openWithFreePort<T>(action: (port: number) => Promise<T>): Promise<T> {
    return withFreePort(action);
  }

  /** Connect to the PowerLine via the tunnel. */
  protected async connectToTunnel(
    environmentId: string,
    localPort: number,
    powerlineToken: string,
  ): Promise<PowerLineConnection> {
    return connectThroughTunnel(environmentId, localPort, powerlineToken);
  }

  /** Close and unregister the tunnel(s) for an environment. */
  protected async closeTunnelForEnvironment(environmentId: string): Promise<void> {
    await closeTunnel(environmentId);
  }

  /** Register an active tunnel pair for an environment. */
  protected registerTunnelForEnvironment(environmentId: string, state: TunnelState): void {
    registerTunnel(environmentId, state);
  }

  /** Get the tunnel state for an environment. */
  protected getTunnelForEnvironment(environmentId: string): TunnelState | undefined {
    return getTunnel(environmentId);
  }

  /** Stop the remote PowerLine and close the tunnel. */
  protected async runRemoteStop(environmentId: string, executor: RemoteExecutor): Promise<void> {
    await remoteStop(environmentId, executor);
  }

  /** Destroy remote PowerLine artifacts and close the tunnel. */
  protected async runRemoteDestroy(environmentId: string, executor: RemoteExecutor): Promise<void> {
    await remoteDestroy(environmentId, executor);
  }

  /** Ping the PowerLine to check liveness. */
  protected async runHealthCheck(connection: PowerLineConnection): Promise<boolean> {
    return remoteHealthCheck(connection);
  }

  // ─── Shared lifecycle ──────────────────────────────────────

  /** Provision the remote host: test connectivity, bootstrap PowerLine, open tunnels. */
  protected async *doProvision(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    const { config: cfg, meta } = this.resolveConfig(config);
    const executor = this.createExecutor(cfg);

    yield {
      stage: "connecting",
      message: `Connecting to ${meta.displayTarget}...`,
      progress: 0.05,
    };
    try {
      await executor.exec("echo ok", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof FatalAdapterError) {
        throw err;
      }
      throw new Error(
        `Cannot reach ${meta.displayTarget}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const { workingDirectory } = await this.preBootstrap(executor, cfg);

    yield* this.runBootstrap(executor, powerlineToken, {
      extraEnv: cfg.env,
      workingDirectory,
      isGitHubProviderEnabled: this.isGitHubProviderEnabled,
      defaultRuntime: (config.defaultRuntime as string) || undefined,
    });

    // Open forward tunnel (retry with a fresh port on TOCTOU conflict, #1486)
    const openTunnel = async (port: number): Promise<{ port: number; tunnel: ProcessTunnel }> => {
      const t = this.createForwardTunnel(port, cfg);
      await t.open();
      return { port, tunnel: t };
    };

    const { port: localPort, tunnel } = cfg.localPort
      ? await openTunnel(cfg.localPort)
      : await this.openWithFreePort(openTunnel);

    yield {
      stage: "tunneling",
      message: `Opening tunnel on local port ${localPort}...`,
      progress: 0.8,
    };

    // Open reverse tunnel (remote → host MCP server) for agent tool calls.
    // Clean up the forward tunnel if the reverse tunnel fails to open.
    try {
      const mcpPort = parseMcpPort();
      const reverseTunnel = this.createReverseTunnel(mcpPort, mcpPort, cfg);
      await reverseTunnel.open();

      this.registerTunnelForEnvironment(environmentId, { tunnel, reverseTunnel });
    } catch (err) {
      await tunnel.close();
      throw err;
    }

    yield {
      stage: "connecting",
      message: `Tunnel open, connecting on port ${localPort}...`,
      progress: 0.9,
    };
  }

  /**
   * Attempt fast reconnect: probe PowerLine, restart if needed, re-open tunnels.
   *
   * Any failure throws and falls through to the caller, which should trigger
   * a full provision via {@link reconnectOrProvision}.
   */
  public async *reconnect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    yield* this.withProvisionLock(
      environmentId,
      this.doReconnect(environmentId, config, powerlineToken),
    );
  }

  private async *doReconnect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    const { config: cfg, meta } = this.resolveConfig(config);
    const executor = this.createExecutor(cfg);

    // 1. Close any stale tunnel
    yield { stage: "reconnecting", message: "Closing stale tunnel...", progress: 0.1 };
    await this.closeTunnelForEnvironment(environmentId);

    // 2. Probe + conditional restart in a single call.
    yield {
      stage: "reconnecting",
      message: `Checking PowerLine on ${meta.displayTarget}...`,
      progress: 0.3,
    };
    const { alreadyRunning } = await this.runStartPowerLine(executor, powerlineToken, {
      extraEnv: cfg.env,
      probeFirst: true,
      ...this.reconnectBootstrapOptions(cfg),
    });
    if (!alreadyRunning) {
      yield { stage: "reconnecting", message: "PowerLine restarted", progress: 0.5 };
    }

    // 3. Open new tunnels (retry on port conflict, #1486)
    const openTunnel = async (port: number): Promise<{ port: number; tunnel: ProcessTunnel }> => {
      const t = this.createForwardTunnel(port, cfg);
      await t.open();
      return { port, tunnel: t };
    };

    const { port: localPort, tunnel } = cfg.localPort
      ? await openTunnel(cfg.localPort)
      : await this.openWithFreePort(openTunnel);

    yield {
      stage: "reconnecting",
      message: `Opening tunnel on local port ${localPort}...`,
      progress: 0.7,
    };

    try {
      const mcpPort = parseMcpPort();
      const reverseTunnel = this.createReverseTunnel(mcpPort, mcpPort, cfg);
      await reverseTunnel.open();

      this.registerTunnelForEnvironment(environmentId, { tunnel, reverseTunnel });
    } catch (err) {
      await tunnel.close();
      throw err;
    }

    yield {
      stage: "reconnecting",
      message: `Reconnected to ${meta.displayTarget}`,
      progress: 0.9,
    };
  }

  /** Connect to the PowerLine through the tunnel. */
  protected async doConnect(
    environmentId: string,
    _config: Record<string, unknown>,
    powerlineToken: string,
  ): Promise<PowerLineConnection> {
    const state = this.getTunnelForEnvironment(environmentId);
    if (!state) {
      throw new Error(`No tunnel registered for environment ${environmentId}`);
    }
    return this.connectToTunnel(environmentId, state.tunnel.localPort, powerlineToken);
  }

  /** Close the tunnel without stopping the remote PowerLine. */
  protected async doDisconnect(environmentId: string): Promise<void> {
    await this.closeTunnelForEnvironment(environmentId);
  }

  /** Stop the remote PowerLine process and close the tunnel. */
  protected async doStop(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const { config: cfg } = this.resolveConfig(config);
    await this.runRemoteStop(environmentId, this.createExecutor(cfg));
  }

  /** Stop the remote PowerLine, remove artifacts, and close the tunnel. */
  protected async doDestroy(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const { config: cfg } = this.resolveConfig(config);
    await this.runRemoteDestroy(environmentId, this.createExecutor(cfg));
  }

  /** Check that the tunnel is alive and the PowerLine responds to a ping. */
  public async healthCheck(connection: PowerLineConnection): Promise<boolean> {
    return this.runHealthCheck(connection);
  }
}
