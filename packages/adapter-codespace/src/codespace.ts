import type {
  RemoteTunnelConfig,
  RemoteTunnelMeta,
  ExecFunction,
  StartRemotePowerLineOptions,
} from "@grackle-ai/adapter-sdk";
import { FatalAdapterError } from "@grackle-ai/adapter-sdk";
import {
  RemoteTunnelAdapter,
  type RemoteExecutor,
  type TunnelProcessFactory,
  type TunnelPortProbe,
  ProcessTunnel,
  ProcessReverseTunnel,
  REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
  SSH_CONNECTIVITY_TIMEOUT_MS,
} from "@grackle-ai/adapter-sdk";
import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";

const REMOTE_COPY_TIMEOUT_MS: number = 120_000;

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

/** Patterns in gh CLI stderr/message that specifically indicate the codespace no longer exists. */
const CODESPACE_NOT_FOUND_PATTERNS: RegExp =
  /error getting codespace|codespace.*does not exist|no such codespace|getting full codespace details/i;

// ─── Config ─────────────────────────────────────────────────

/** GitHub Codespaces-specific environment configuration. */
export interface CodespaceEnvironmentConfig extends RemoteTunnelConfig {
  /** The codespace name from `gh codespace list` (required). */
  codespaceName: string;
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
      "codespace",
      "cp",
      "-r",
      "-e",
      "-c",
      this.codespaceName,
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
      "codespace",
      "ports",
      "forward",
      `${DEFAULT_POWERLINE_PORT}:${this.localPort}`,
      "-c",
      this.codespaceName,
    ];
    return { command: "gh", args };
  }
}

/**
 * Reverse SSH tunnel: binds a port inside the codespace that tunnels back to a local port.
 * Used so agents (running in the codespace) can reach the Grackle MCP server (on the host).
 */
class CodespaceReverseTunnel extends ProcessReverseTunnel {
  private readonly codespaceName: string;

  public constructor(
    localPort: number,
    remotePort: number,
    codespaceName: string,
    sleepFn: (ms: number) => Promise<void>,
    processFactory?: TunnelProcessFactory,
    portProbe?: TunnelPortProbe,
    ghToken?: string,
  ) {
    super(localPort, remotePort, sleepFn, processFactory, portProbe);
    this.codespaceName = codespaceName;
    if (ghToken) {
      this.spawnEnv = { GH_TOKEN: ghToken };
    }
  }

  /** Return the gh codespace ssh command with -R for reverse port forwarding. */
  protected spawnArgs(): { command: string; args: string[] } {
    const args = [
      "codespace",
      "ssh",
      "-c",
      this.codespaceName,
      "--",
      "-R",
      `${this.remotePort}:127.0.0.1:${this.localPort}`,
      "-N",
    ];
    return { command: "gh", args };
  }
}

// ─── Adapter ────────────────────────────────────────────────

/** Environment adapter that provisions and manages GitHub Codespaces running the PowerLine. */
export class CodespaceAdapter extends RemoteTunnelAdapter<CodespaceEnvironmentConfig> {
  public type: string = "codespace";

  /** Validate and parse the raw config into typed Codespace configuration. */
  protected resolveConfig(config: Record<string, unknown>): {
    config: CodespaceEnvironmentConfig;
    meta: RemoteTunnelMeta;
  } {
    const cfg = config as unknown as CodespaceEnvironmentConfig;
    if (!cfg.codespaceName) {
      throw new Error("Codespace adapter requires a 'codespaceName' in the configuration");
    }
    return { config: cfg, meta: { displayTarget: `codespace ${cfg.codespaceName}` } };
  }

  /** Create a Codespace executor with optional GitHub token injection. */
  protected createExecutor(cfg: CodespaceEnvironmentConfig): RemoteExecutor {
    const ghToken = this.resolveGitHubToken(cfg.githubAccountId || undefined);
    return new CodespaceExecutor(cfg.codespaceName, this.execFn, ghToken);
  }

  /** Create a port-forward tunnel via `gh codespace ports forward`. */
  protected createForwardTunnel(localPort: number, cfg: CodespaceEnvironmentConfig): ProcessTunnel {
    const ghToken = this.resolveGitHubToken(cfg.githubAccountId || undefined);
    return new CodespaceTunnel(localPort, cfg.codespaceName, undefined, undefined, ghToken);
  }

  /** Create a reverse SSH tunnel via `gh codespace ssh -- -R`. */
  protected createReverseTunnel(
    localPort: number,
    remotePort: number,
    cfg: CodespaceEnvironmentConfig,
  ): ProcessTunnel {
    const ghToken = this.resolveGitHubToken(cfg.githubAccountId || undefined);
    return new CodespaceReverseTunnel(
      localPort,
      remotePort,
      cfg.codespaceName,
      this.sleepFn,
      undefined,
      undefined,
      ghToken,
    );
  }

  /** Detect the repo working directory (codespaces clone to /workspaces/<name>). */
  protected async preBootstrap(
    executor: RemoteExecutor,
    _config: CodespaceEnvironmentConfig,
  ): Promise<{ workingDirectory?: string }> {
    try {
      const workspaceDir = (
        await executor.exec("ls -d /workspaces/*/ 2>/dev/null | head -1", {
          timeout: SSH_CONNECTIVITY_TIMEOUT_MS,
        })
      )
        .trim()
        .replace(/\/$/, "");
      if (workspaceDir) {
        return { workingDirectory: workspaceDir };
      }
    } catch {
      // Non-fatal — fall back to PowerLine directory
    }
    return {};
  }

  /** On reconnect, auto-detect the workspace directory. */
  protected reconnectBootstrapOptions(
    _config: CodespaceEnvironmentConfig,
  ): Partial<StartRemotePowerLineOptions> {
    return { autoDetectWorkspace: true };
  }
}
