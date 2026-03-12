import type { EnvironmentAdapter, BaseEnvironmentConfig, PowerLineConnection, ProvisionEvent } from "./adapter.js";
import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";
import {
  type RemoteExecutor,
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
  writeRemoteEnvFile,
  probeRemotePowerLine,
  startRemotePowerLine,
  SSH_CONNECTIVITY_TIMEOUT_MS,
  REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
} from "./remote-adapter-utils.js";
import { exec } from "../utils/exec.js";

const REMOTE_COPY_TIMEOUT_MS: number = 120_000;

// ─── Config ─────────────────────────────────────────────────

/** GitHub Codespaces-specific environment configuration. */
export interface CodespaceEnvironmentConfig extends BaseEnvironmentConfig {
  /** The codespace name from `gh codespace list` (required). */
  codespaceName: string;
  /** Override the local tunnel port (otherwise a free port is chosen). */
  localPort?: number;
  /** Additional environment variables forwarded to the remote PowerLine. */
  env?: Record<string, string>;
}

// ─── Executor ───────────────────────────────────────────────

/** Execute commands inside a GitHub Codespace via the `gh` CLI. */
class CodespaceExecutor implements RemoteExecutor {
  private readonly codespaceName: string;

  public constructor(codespaceName: string) {
    this.codespaceName = codespaceName;
  }

  /** Execute a shell command inside the codespace and return trimmed stdout. */
  public async exec(command: string, opts?: { timeout?: number }): Promise<string> {
    const args = ["codespace", "ssh", "-c", this.codespaceName, "--", command];
    const result = await exec("gh", args, { timeout: opts?.timeout ?? REMOTE_EXEC_DEFAULT_TIMEOUT_MS });
    return result.stdout;
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
    await exec("gh", args, { timeout: REMOTE_COPY_TIMEOUT_MS });
  }
}

// ─── Tunnel ─────────────────────────────────────────────────

/** Port-forwarding tunnel using `gh codespace ports forward`. */
class CodespaceTunnel extends ProcessTunnel {
  private readonly codespaceName: string;

  public constructor(localPort: number, codespaceName: string) {
    super(localPort);
    this.codespaceName = codespaceName;
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

// ─── Adapter ────────────────────────────────────────────────

/** Environment adapter that provisions and manages GitHub Codespaces running the PowerLine. */
export class CodespaceAdapter implements EnvironmentAdapter {
  public type: string = "codespace";

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

    const executor = new CodespaceExecutor(cfg.codespaceName);

    // Test codespace connectivity
    yield { stage: "connecting", message: `Connecting to codespace ${cfg.codespaceName}...`, progress: 0.05 };
    try {
      await executor.exec("echo ok", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });
    } catch (err) {
      throw new Error(`Cannot reach codespace '${cfg.codespaceName}' via gh CLI: ${err}`);
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
    yield* bootstrapPowerLine(executor, powerlineToken, cfg.env, workingDirectory);

    // Open port-forward tunnel
    const localPort = cfg.localPort || await findFreePort();
    yield { stage: "tunneling", message: `Forwarding local port ${localPort} to codespace...`, progress: 0.80 };

    const tunnel = new CodespaceTunnel(localPort, cfg.codespaceName);
    await tunnel.open();
    registerTunnel(environmentId, { tunnel });

    yield { stage: "connecting", message: `Tunnel open, connecting on port ${localPort}...`, progress: 0.90 };
  }

  /**
   * Attempt fast reconnect: verify SSH, probe PowerLine, restart if needed, re-open tunnel.
   * Only falls through to the caller (which triggers full provision) if SSH itself is unreachable.
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

    const executor = new CodespaceExecutor(cfg.codespaceName);

    // 1. Close any stale tunnel
    yield { stage: "reconnecting", message: "Closing stale tunnel...", progress: 0.10 };
    await closeTunnel(environmentId);

    // 2. Test codespace SSH connectivity
    yield { stage: "reconnecting", message: `Reconnecting to codespace ${cfg.codespaceName}...`, progress: 0.20 };
    await executor.exec("echo ok", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });

    // 3. Update env vars file (tokens may have rotated)
    yield { stage: "reconnecting", message: "Updating environment variables...", progress: 0.30 };
    await writeRemoteEnvFile(executor, powerlineToken, cfg.env);

    // 4. Probe remote PowerLine — restart if not running
    yield { stage: "reconnecting", message: "Checking PowerLine process...", progress: 0.40 };
    try {
      await probeRemotePowerLine(executor);
    } catch {
      // PowerLine is not running — restart it without full reinstall
      yield { stage: "reconnecting", message: "PowerLine not running, restarting...", progress: 0.50 };

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

      await startRemotePowerLine(executor, powerlineToken, cfg.env, workingDirectory);
    }

    // 5. Open new port-forward tunnel
    const localPort = cfg.localPort || await findFreePort();
    yield { stage: "reconnecting", message: `Forwarding local port ${localPort} to codespace...`, progress: 0.70 };
    const tunnel = new CodespaceTunnel(localPort, cfg.codespaceName);
    await tunnel.open();
    registerTunnel(environmentId, { tunnel });

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
    await remoteStop(environmentId, new CodespaceExecutor(cfg.codespaceName));
  }

  /**
   * Stop the remote PowerLine and remove artifacts from the codespace.
   * This does NOT delete the codespace itself.
   */
  public async destroy(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as CodespaceEnvironmentConfig;
    await remoteDestroy(environmentId, new CodespaceExecutor(cfg.codespaceName));
  }

  /** Check that the tunnel is alive and the PowerLine responds to a ping. */
  public async healthCheck(connection: PowerLineConnection): Promise<boolean> {
    return remoteHealthCheck(connection);
  }
}
