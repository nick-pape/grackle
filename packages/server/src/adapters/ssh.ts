import type { EnvironmentAdapter, BaseEnvironmentConfig, PowerLineConnection, ProvisionEvent } from "@grackle-ai/adapter-sdk";
import { DEFAULT_POWERLINE_PORT, DEFAULT_MCP_PORT } from "@grackle-ai/common";
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
  startRemotePowerLine,
  SSH_CONNECTIVITY_TIMEOUT_MS,
  REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
} from "@grackle-ai/adapter-sdk";
import { getCredentialProviders } from "../credential-providers.js";
import { exec } from "../utils/exec.js";
import { spawn } from "node:child_process";
import { sleep } from "../utils/sleep.js";
import { logger } from "../logger.js";

const REMOTE_COPY_TIMEOUT_MS: number = 120_000;

// ─── Config ─────────────────────────────────────────────────

/** SSH-specific environment configuration. */
export interface SshEnvironmentConfig extends BaseEnvironmentConfig {
  /** Remote hostname or IP address (required). */
  host: string;
  /** SSH username (defaults to the current OS user). */
  user?: string;
  /** SSH port on the remote host (defaults to 22). */
  sshPort?: number;
  /** Path to an SSH private key file. */
  identityFile?: string;
  /** Extra SSH options passed as `-o Key=Value`. */
  sshOptions?: Record<string, string>;
  /** Override the local tunnel port (otherwise a free port is chosen). */
  localPort?: number;
  /** Additional environment variables forwarded to the remote PowerLine. */
  env?: Record<string, string>;
}

// ─── SSH Helpers ────────────────────────────────────────────

/** Build the common SSH flags shared across exec, scp, and tunnel commands. */
function buildSshFlags(cfg: SshEnvironmentConfig): string[] {
  const flags: string[] = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"];
  if (cfg.sshPort) {
    flags.push("-p", String(cfg.sshPort));
  }
  if (cfg.identityFile) {
    flags.push("-i", cfg.identityFile);
  }
  if (cfg.sshOptions) {
    for (const [key, value] of Object.entries(cfg.sshOptions)) {
      flags.push("-o", `${key}=${value}`);
    }
  }
  return flags;
}

/** Build the `user@host` destination string. */
function buildDestination(cfg: SshEnvironmentConfig): string {
  return cfg.user ? `${cfg.user}@${cfg.host}` : cfg.host;
}

// ─── Executor ───────────────────────────────────────────────

/** Execute commands on a remote host via SSH. */
class SshExecutor implements RemoteExecutor {
  private readonly cfg: SshEnvironmentConfig;

  public constructor(cfg: SshEnvironmentConfig) {
    this.cfg = cfg;
  }

  /** Execute a shell command on the remote host and return trimmed stdout. */
  public async exec(command: string, opts?: { timeout?: number }): Promise<string> {
    const args = [...buildSshFlags(this.cfg), buildDestination(this.cfg), command];
    const result = await exec("ssh", args, { timeout: opts?.timeout ?? REMOTE_EXEC_DEFAULT_TIMEOUT_MS });
    return result.stdout;
  }

  /** Copy a local file or directory to the remote host via scp. */
  public async copyTo(localPath: string, remotePath: string): Promise<void> {
    const flags = buildSshFlags(this.cfg);
    // scp uses -P (uppercase) instead of -p for port
    const scpFlags = flags.map((f, i) => (f === "-p" && i > 0 && flags[i - 1] !== "-o") ? "-P" : f);
    const args = ["-r", ...scpFlags, localPath, `${buildDestination(this.cfg)}:${remotePath}`];
    await exec("scp", args, { timeout: REMOTE_COPY_TIMEOUT_MS });
  }
}

// ─── Tunnel ─────────────────────────────────────────────────

/** SSH tunnel that forwards a local port to the remote PowerLine port. */
class SshTunnel extends ProcessTunnel {
  private readonly cfg: SshEnvironmentConfig;

  public constructor(localPort: number, cfg: SshEnvironmentConfig) {
    super(localPort);
    this.cfg = cfg;
  }

  /** Return the ssh command and arguments for the tunnel process. */
  protected spawnArgs(): { command: string; args: string[] } {
    const flags = buildSshFlags(this.cfg);
    const args = [
      "-N",
      "-L", `${this.localPort}:127.0.0.1:${DEFAULT_POWERLINE_PORT}`,
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      ...flags,
      buildDestination(this.cfg),
    ];
    return { command: "ssh", args };
  }
}

/**
 * Reverse SSH tunnel: binds a port on the remote host that tunnels back to a local port.
 * Used so agents (running on the remote host) can reach the Grackle MCP server (on the host).
 */
class SshReverseTunnel extends ProcessTunnel {
  private readonly cfg: SshEnvironmentConfig;
  private readonly remotePort: number;

  public constructor(localPort: number, remotePort: number, cfg: SshEnvironmentConfig) {
    super(localPort);
    this.cfg = cfg;
    this.remotePort = remotePort;
  }

  /** Return the ssh command with -R for reverse port forwarding. */
  protected spawnArgs(): { command: string; args: string[] } {
    const flags = buildSshFlags(this.cfg);
    const args = [
      "-N",
      "-R", `${this.remotePort}:127.0.0.1:${this.localPort}`,
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      ...flags,
      buildDestination(this.cfg),
    ];
    return { command: "ssh", args };
  }

  /**
   * Override open() — reverse tunnels bind on the remote side, not locally.
   * We can't probe the remote port, so just wait a fixed delay for SSH to establish.
   */
  public async open(): Promise<void> {
    const { command, args } = this.spawnArgs();
    logger.info({ command, args }, "Opening reverse tunnel");

    this.process = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      detached: false,
    });

    this.process.on("error", (err) => {
      logger.error({ err }, "Reverse tunnel process error");
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      logger.debug({ stderr: data.toString() }, "Reverse tunnel stderr");
    });

    // Give SSH time to establish the connection and bind the remote port
    await sleep(3000);

    if (this.process.exitCode !== null) {
      throw new Error(`Reverse tunnel exited immediately with code ${this.process.exitCode}`);
    }
  }
}

// ─── Adapter ────────────────────────────────────────────────

/** Environment adapter that provisions and manages remote environments via SSH. */
export class SshAdapter implements EnvironmentAdapter {
  public type: string = "ssh";

  /** Provision the remote host: test connectivity, bootstrap PowerLine, open tunnel. */
  public async *provision(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as SshEnvironmentConfig;
    if (!cfg.host) {
      throw new Error("SSH adapter requires a 'host' in the configuration");
    }

    const executor = new SshExecutor(cfg);

    // Test SSH connectivity
    yield { stage: "connecting", message: `Testing SSH connectivity to ${cfg.host}...`, progress: 0.05 };
    try {
      await executor.exec("echo ok", { timeout: SSH_CONNECTIVITY_TIMEOUT_MS });
    } catch (err) {
      throw new Error(`Cannot reach ${cfg.host} via SSH: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Bootstrap PowerLine on the remote host
    yield* bootstrapPowerLine(executor, powerlineToken, {
      extraEnv: cfg.env,
      isGitHubProviderEnabled: () => getCredentialProviders().github !== "off",
    });

    // Open SSH tunnel
    const localPort = cfg.localPort || await findFreePort();
    yield { stage: "tunneling", message: `Opening SSH tunnel on local port ${localPort}...`, progress: 0.80 };

    const tunnel = new SshTunnel(localPort, cfg);
    await tunnel.open();

    // Open reverse tunnel (remote → host MCP server) for agent tool calls
    const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
    const reverseTunnel = new SshReverseTunnel(mcpPort, mcpPort, cfg);
    await reverseTunnel.open();

    registerTunnel(environmentId, { tunnel, reverseTunnel });

    yield { stage: "connecting", message: `Tunnel open, connecting on port ${localPort}...`, progress: 0.90 };
  }

  /**
   * Attempt fast reconnect: probe PowerLine, restart if needed, re-open tunnel.
   *
   * Any failure (SSH unreachable, PowerLine won't start, tunnel error) throws
   * and falls through to the caller, which should trigger a full provision.
   *
   * Minimizes SSH round trips — probe and conditional restart run in a single
   * SSH call via `startRemotePowerLine({ probeFirst: true })`.
   */
  public async *reconnect(
    environmentId: string,
    config: Record<string, unknown>,
    powerlineToken: string,
  ): AsyncGenerator<ProvisionEvent> {
    const cfg = config as unknown as SshEnvironmentConfig;
    if (!cfg.host) {
      throw new Error("SSH adapter requires a 'host' in the configuration");
    }

    const executor = new SshExecutor(cfg);

    // 1. Close any stale tunnel
    yield { stage: "reconnecting", message: "Closing stale tunnel...", progress: 0.10 };
    await closeTunnel(environmentId);

    // 2. Probe + conditional restart in a single SSH call.
    yield { stage: "reconnecting", message: `Checking PowerLine on ${cfg.host}...`, progress: 0.30 };
    const { alreadyRunning } = await startRemotePowerLine(executor, powerlineToken, {
      extraEnv: cfg.env,
      probeFirst: true,
    });
    if (!alreadyRunning) {
      yield { stage: "reconnecting", message: "PowerLine restarted", progress: 0.50 };
    }

    // 3. Open new SSH tunnel + reverse tunnel for MCP
    const localPort = cfg.localPort || await findFreePort();
    yield { stage: "reconnecting", message: `Opening SSH tunnel on local port ${localPort}...`, progress: 0.70 };
    const tunnel = new SshTunnel(localPort, cfg);
    await tunnel.open();

    const mcpPort = parseInt(process.env.GRACKLE_MCP_PORT || String(DEFAULT_MCP_PORT), 10);
    const reverseTunnel = new SshReverseTunnel(mcpPort, mcpPort, cfg);
    await reverseTunnel.open();

    registerTunnel(environmentId, { tunnel, reverseTunnel });

    yield { stage: "reconnecting", message: "Reconnected via SSH", progress: 0.90 };
  }

  /** Connect to the PowerLine through the SSH tunnel. */
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

  /** Close the SSH tunnel without stopping the remote PowerLine. */
  public async disconnect(environmentId: string): Promise<void> {
    await closeTunnel(environmentId);
  }

  /** Stop the remote PowerLine process and close the tunnel. */
  public async stop(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as SshEnvironmentConfig;
    await remoteStop(environmentId, new SshExecutor(cfg));
  }

  /** Stop the remote PowerLine, remove artifacts, and close the tunnel. */
  public async destroy(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as SshEnvironmentConfig;
    await remoteDestroy(environmentId, new SshExecutor(cfg));
  }

  /** Check that the tunnel is alive and the PowerLine responds to a ping. */
  public async healthCheck(connection: PowerLineConnection): Promise<boolean> {
    return remoteHealthCheck(connection);
  }
}
