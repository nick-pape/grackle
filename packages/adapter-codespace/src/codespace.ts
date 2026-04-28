import type { EnvironmentAdapter, BaseEnvironmentConfig, PowerLineConnection, ProvisionEvent, AdapterDependencies, ExecFunction } from "@grackle-ai/adapter-sdk";
import { FatalAdapterError } from "@grackle-ai/adapter-sdk";
import { DEFAULT_POWERLINE_PORT, DEFAULT_MCP_PORT } from "@grackle-ai/common";
import {
  type RemoteExecutor,
  type TunnelProcessFactory,
  type TunnelPortProbe,
  ProcessTunnel,
  bootstrapPowerLine,
  connectThroughTunnel,
  registerTunnel,
  getTunnel,
  closeTunnel,
  findFreePort,
  remoteStop,
  remoteDestroy,
  remoteHealthCheck,
  startRemotePowerLine,
  exec as defaultExec,
  sleep as defaultSleep,
  SSH_CONNECTIVITY_TIMEOUT_MS,
  REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
} from "@grackle-ai/adapter-sdk";

const REMOTE_COPY_TIMEOUT_MS: number = 120_000;

/** Delay for reverse tunnels to wait for SSH to establish. */
const REVERSE_TUNNEL_SETTLE_MS: number = 3_000;

/**
 * Thrown when the codespace no longer exists on GitHub.
 * Extends `FatalAdapterError` so the auto-reconnect loop stops immediately
 * and marks the environment as `error` rather than continuing to retry.
 */
export class CodespaceNotFoundError extends FatalAdapterError {
  public constructor(codespaceName: string) {
    super(`Codespace '${codespaceName}' not found — it may have been deleted`);
    this.name = "CodespaceNotFoundError";
  }
}

/** Patterns in gh CLI stderr that indicate the codespace no longer exists. */
const CODESPACE_NOT_FOUND_PATTERNS: RegExp = /not found|does not exist|no such codespace/i;

// ─── Config ─────────────────────────────────────────────────

/** GitHub Codespaces-specific environment configuration. */
export interface CodespaceEnvironmentConfig extends BaseEnvironmentConfig {
  /** The codespace name from `gh codespace list` (required). */
  codespaceName: string;
  /** Override the local tunnel port (otherwise a free port is chosen). */
  localPort?: number;
  /** Additional environment variables forwarded to the remote PowerLine. */
  env?: Record<string, string>;
  /**
   * ID of the GitHub account to use for `gh` CLI operations on this environment.
   * When set, the account's token is injected as `GH_TOKEN` into all `gh` calls.
   * When absent, the default system `gh` CLI authentication is used.
   */
  githubAccountId?: string;
}

// ─── Executor ───────────────────────────────────────────────

/** Execute commands inside a GitHub Codespace via the `gh` CLI. */
class CodespaceExecutor implements RemoteExecutor {
  private readonly codespaceName: string;
  private readonly execFn: ExecFunction;
  private readonly ghEnv: NodeJS.ProcessEnv;

  public constructor(codespaceName: string, execFn: ExecFunction, ghToken?: string) {
    this.codespaceName = codespaceName;
    this.execFn = execFn;
    this.ghEnv = ghToken ? { ...process.env, GH_TOKEN: ghToken } : process.env;
  }

  /** Execute a shell command inside the codespace and return trimmed stdout. */
  public async exec(command: string, opts?: { timeout?: number }): Promise<string> {
    const args = ["codespace", "ssh", "-c", this.codespaceName, "--", command];
    try {
      const result = await this.execFn("gh", args, {
        timeout: opts?.timeout ?? REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
        env: this.ghEnv,
      });
      return result.stdout;
    } catch (err) {
      this.rethrowIfNotFound(err);
      throw err;
    }
  }

  /** Copy a local file or directory into the codespace via `gh codespace cp`. */
  public async copyTo(localPath: string, remotePath: string): Promise<void> {
    // Resolve $HOME since gh codespace cp uses SCP, which doesn't expand shell variables
    let resolvedPath = remotePath;
    if (resolvedPath.includes("$HOME")) {
      const home = (await this.exec("echo $HOME")).trim();
      resolvedPath = resolvedPath.replace(/\$HOME/g, home);
    }
    const args = [
      "codespace", "cp", "-r", "-e",
      "-c", this.codespaceName,
      localPath,
      `remote:${resolvedPath}`,
    ];
    try {
      await this.execFn("gh", args, { timeout: REMOTE_COPY_TIMEOUT_MS, env: this.ghEnv });
    } catch (err) {
      this.rethrowIfNotFound(err);
      throw err;
    }
  }

  /** Throw {@link CodespaceNotFoundError} if the error indicates the codespace was deleted. */
  private rethrowIfNotFound(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (CODESPACE_NOT_FOUND_PATTERNS.test(message) || CODESPACE_NOT_FOUND_PATTERNS.test(stderr)) {
      throw new CodespaceNotFoundError(this.codespaceName);
    }
  }
}

// ─── Tunnel ─────────────────────────────────────────────────

/** Port-forwarding tunnel using `gh codespace ports forward`. */
class CodespaceTunnel extends ProcessTunnel {
  private readonly codespaceName: string;

  public constructor(
    localPort: number,
    codespaceName: string,
    processFactory?: TunnelProcessFactory,
    portProbe?: TunnelPortProbe,
    ghToken?: string,
  ) {
    super(localPort, undefined, processFactory, portProbe);
    this.codespaceName = codespaceName;
    if (ghToken) {
      this.spawnEnv = { GH_TOKEN: ghToken };
    }
  }

  /** Return the gh command and arguments for the port-forward process. */
  protected spawnArgs(): { command: string; args: string[] } {
    // gh codespace ports forward uses <remote>:<local> order (opposite of SSH -L)
    const args = [
      "codespace", "ports", "forward",
      `${DEFAULT_POWERLINE_PORT}:${this.localPort}`,
      "-c", this.codespaceName,
    ];
    return { command: "gh", args };
  }
}

/**
 * Reverse SSH tunnel: binds a port inside the codespace that tunnels back to a local port.
 * Used so agents (running in the codespace) can reach the Grackle MCP server (on the host).
 */
class CodespaceReverseTunnel extends ProcessTunnel {
  private readonly codespaceName: string;
  private readonly remotePort: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  public constructor(
    localPort: number,
    remotePort: number,
    codespaceName: string,
    sleepFn: (ms: number) => Promise<void>,
    processFactory?: TunnelProcessFactory,
    portProbe?: TunnelPortProbe,
    ghToken?: string,
  ) {
    super(localPort, undefined, processFactory, portProbe);
    this.remotePort = remotePort;
    this.codespaceName = codespaceName;
    this.sleepFn = sleepFn;
    if (ghToken) {
      this.spawnEnv = { GH_TOKEN: ghToken };
    }
  }

  /** Return the gh codespace ssh command with -R for reverse port forwarding. */
  protected spawnArgs(): { command: string; args: string[] } {
    const args = [
      "codespace", "ssh",
      "-c", this.codespaceName,
      "--",
      "-R", `${this.remotePort}:127.0.0.1:${this.localPort}`,
      "-N",
    ];
    return { command: "gh", args };
  }

  /**
   * Reverse tunnels bind on the remote side, not locally.
   * We can't probe the remote port, so wait a fixed delay for SSH to establish.
   */
  protected async waitForReady(): Promise<void> {
    await this.sleepFn(REVERSE_TUNNEL_SETTLE_MS);
    if (this.process?.exitCode !== null) {
      throw new Error(`Reverse tunnel exited immediately with code ${this.process?.exitCode}`);
    }
  }
}

// ─── Adapter ────────────────────────────────────────────────

/** Environment adapter that provisions and manages GitHub Codespaces running the PowerLine. */
export class CodespaceAdapter implements EnvironmentAdapter {
  public type: string = "codespace";
  private readonly execFn: ExecFunction;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly isGitHubProviderEnabled: () => boolean;
  private readonly resolveGitHubToken: (accountId?: string) => string | undefined;

  public constructor(deps: AdapterDependencies = {}) {
    this.execFn = deps.exec ?? defaultExec;
    this.sleepFn = deps.sleep ?? defaultSleep;
    this.isGitHubProviderEnabled = deps.isGitHubProviderEnabled ?? (() => false);
    this.resolveGitHubToken = deps.resolveGitHubToken ?? (() => undefined);
  }

  /** Provision the codespace: verify connectivity, bootstrap PowerLine, open port-forward. */
  public async *provision(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as CodespaceEnvironmentConfig;
    if (!cfg.codespaceName) {
      throw new Error("Codespace adapter requires a 'codespaceName' in the configuration");
    }

    const ghToken = this.resolveGitHubToken(cfg.githubAccountId || undefined);
    const executor = new CodespaceExecutor(cfg.codespaceName, this.execFn, ghToken);

    // Test codespace connectivity
    yield { stage: "connecting", message: `Connecting to codespace ${cfg.codespaceName}...`, progress: 0.05 };
    try {
      await executor.exec("echo ok", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof FatalAdapterError) {
        throw err;
      }
      throw new Error(`Cannot reach codespace '${cfg.codespaceName}' via gh CLI: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Detect the repo working directory (codespaces clone to /workspaces/<name>)
    let workingDirectory: string | undefined;
    try {
      const workspaceDir = (await executor.exec(
        "ls -d /workspaces/*/ 2>/dev/null | head -1",
        { timeout: SSH_CONNECTIVITY_TIMEOUT_MS },
      )).trim().replace(/\/$/, "");
      if (workspaceDir) {
        workingDirectory = workspaceDir;
      }
    } catch {
      // Non-fatal — fall back to PowerLine directory
    }

    // Bootstrap PowerLine on the codespace
    yield* bootstrapPowerLine(executor, powerlineToken, {
      extraEnv: cfg.env,
      workingDirectory,
      isGitHubProviderEnabled: this.isGitHubProviderEnabled,
      defaultRuntime: (config.defaultRuntime as string) || undefined,
    });

    // Open port-forward tunnel (host → codespace PowerLine)
    const localPort = cfg.localPort || await findFreePort();
    yield { stage: "tunneling", message: `Forwarding local port ${localPort} to codespace...`, progress: 0.80 };

    const tunnel = new CodespaceTunnel(localPort, cfg.codespaceName, undefined, undefined, ghToken);
    await tunnel.open();

    // Open reverse tunnel (codespace → host MCP server) for agent tool calls
    const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
    const reverseTunnel = new CodespaceReverseTunnel(mcpPort, mcpPort, cfg.codespaceName, this.sleepFn, undefined, undefined, ghToken);
    await reverseTunnel.open();

    registerTunnel(environmentId, { tunnel, reverseTunnel });

    yield { stage: "connecting", message: `Tunnel open, connecting on port ${localPort}...`, progress: 0.90 };
  }

  /**
   * Attempt fast reconnect: probe PowerLine, restart if needed, re-open tunnel.
   */
  public async *reconnect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as CodespaceEnvironmentConfig;
    if (!cfg.codespaceName) {
      throw new Error("Codespace adapter requires a 'codespaceName' in the configuration");
    }

    const ghToken = this.resolveGitHubToken(cfg.githubAccountId || undefined);
    const executor = new CodespaceExecutor(cfg.codespaceName, this.execFn, ghToken);

    // 1. Close any stale tunnel
    yield { stage: "reconnecting", message: "Closing stale tunnel...", progress: 0.10 };
    await closeTunnel(environmentId);

    // 2. Probe + conditional restart in a single SSH call.
    yield { stage: "reconnecting", message: `Checking PowerLine on ${cfg.codespaceName}...`, progress: 0.30 };
    const { alreadyRunning } = await startRemotePowerLine(executor, powerlineToken, {
      extraEnv: cfg.env,
      autoDetectWorkspace: true,
      probeFirst: true,
    });
    if (!alreadyRunning) {
      yield { stage: "reconnecting", message: "PowerLine restarted", progress: 0.50 };
    }

    // 3. Open new port-forward tunnel + reverse tunnel for MCP
    const localPort = cfg.localPort || await findFreePort();
    yield { stage: "reconnecting", message: `Forwarding local port ${localPort} to codespace...`, progress: 0.70 };
    const tunnel = new CodespaceTunnel(localPort, cfg.codespaceName, undefined, undefined, ghToken);
    await tunnel.open();

    const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
    const reverseTunnel = new CodespaceReverseTunnel(mcpPort, mcpPort, cfg.codespaceName, this.sleepFn, undefined, undefined, ghToken);
    await reverseTunnel.open();

    registerTunnel(environmentId, { tunnel, reverseTunnel });

    yield { stage: "reconnecting", message: "Reconnected to codespace", progress: 0.90 };
  }

  /** Connect to the PowerLine through the port-forward tunnel. */
  public async connect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): Promise<PowerLineConnection> {
    const state = getTunnel(environmentId);
    if (!state) {
      throw new Error(`No tunnel registered for environment ${environmentId}`);
    }
    return connectThroughTunnel(environmentId, state.tunnel.localPort, powerlineToken);
  }

  /** Close the port-forward tunnel without stopping the remote PowerLine. */
  public async disconnect(environmentId: string): Promise<void> {
    await closeTunnel(environmentId);
  }

  /** Stop the remote PowerLine process and close the tunnel. */
  public async stop(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as CodespaceEnvironmentConfig;
    const ghToken = this.resolveGitHubToken(cfg.githubAccountId || undefined);
    await remoteStop(environmentId, new CodespaceExecutor(cfg.codespaceName, this.execFn, ghToken));
  }

  /**
   * Stop the remote PowerLine and remove artifacts from the codespace.
   * This does NOT delete the codespace itself.
   */
  public async destroy(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as CodespaceEnvironmentConfig;
    const ghToken = this.resolveGitHubToken(cfg.githubAccountId || undefined);
    await remoteDestroy(environmentId, new CodespaceExecutor(cfg.codespaceName, this.execFn, ghToken));
  }

  /** Check that the tunnel is alive and the PowerLine responds to a ping. */
  public async healthCheck(connection: PowerLineConnection): Promise<boolean> {
    return remoteHealthCheck(connection);
  }
}
