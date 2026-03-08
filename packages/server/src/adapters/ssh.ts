import type { EnvironmentAdapter, BaseEnvironmentConfig, PowerLineConnection, ProvisionEvent } from "./adapter.js";
import {
  type RemoteExecutor,
  ProcessTunnel,
  bootstrapPowerLine,
  connectThroughTunnel,
  registerTunnel,
  getTunnel,
  closeTunnel,
  findFreePort,
  SSH_CONNECTIVITY_TIMEOUT_MS,
  REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
  REMOTE_POWERLINE_DIRECTORY,
} from "./remote-adapter-utils.js";
import { exec } from "../utils/exec.js";
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
      "-L", `${this.localPort}:127.0.0.1:7433`,
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      ...flags,
      buildDestination(this.cfg),
    ];
    return { command: "ssh", args };
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
      throw new Error(`Cannot reach ${cfg.host} via SSH: ${err}`);
    }

    // Bootstrap PowerLine on the remote host
    yield* bootstrapPowerLine(executor, powerlineToken);

    // Open SSH tunnel
    const localPort = cfg.localPort || await findFreePort();
    yield { stage: "tunneling", message: `Opening SSH tunnel on local port ${localPort}...`, progress: 0.80 };

    const tunnel = new SshTunnel(localPort, cfg);
    await tunnel.open();
    registerTunnel(environmentId, { tunnel });

    yield { stage: "connecting", message: `Tunnel open, connecting on port ${localPort}...`, progress: 0.90 };
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
    const executor = new SshExecutor(cfg);

    try {
      await executor.exec("fuser -k 7433/tcp 2>/dev/null || true");
    } catch (err) {
      logger.debug({ environmentId, err }, "Failed to kill remote PowerLine (may already be stopped)");
    }
    await closeTunnel(environmentId);
  }

  /** Stop the remote PowerLine, remove artifacts, and close the tunnel. */
  public async destroy(environmentId: string, config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as SshEnvironmentConfig;
    const executor = new SshExecutor(cfg);

    try {
      await executor.exec(`fuser -k 7433/tcp 2>/dev/null || true; rm -rf ${REMOTE_POWERLINE_DIRECTORY}`);
    } catch (err) {
      logger.debug({ environmentId, err }, "Failed to clean up remote PowerLine artifacts");
    }
    await closeTunnel(environmentId);
  }

  /** Check that the tunnel is alive and the PowerLine responds to a ping. */
  public async healthCheck(connection: PowerLineConnection): Promise<boolean> {
    const state = getTunnel(connection.environmentId);
    if (!state || !state.tunnel.isAlive()) {
      return false;
    }
    try {
      await connection.client.ping({});
      return true;
    } catch {
      return false;
    }
  }
}
