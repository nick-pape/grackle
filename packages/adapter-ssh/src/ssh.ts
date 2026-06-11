import type { RemoteTunnelConfig, RemoteTunnelMeta, ExecFunction } from "@grackle-ai/adapter-sdk";
import { DEFAULT_POWERLINE_PORT } from "@grackle-ai/common";
import {
  RemoteTunnelAdapter,
  type RemoteExecutor,
  type TunnelProcessFactory,
  type TunnelPortProbe,
  ProcessTunnel,
  ProcessReverseTunnel,
  REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
  REMOTE_COPY_TIMEOUT_MS,
} from "@grackle-ai/adapter-sdk";

// ─── Config ─────────────────────────────────────────────────

/** SSH-specific environment configuration. */
export interface SshEnvironmentConfig extends RemoteTunnelConfig {
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
  private readonly execFn: ExecFunction;

  public constructor(cfg: SshEnvironmentConfig, execFn: ExecFunction) {
    this.cfg = cfg;
    this.execFn = execFn;
  }

  /** Execute a shell command on the remote host and return trimmed stdout. */
  public async exec(command: string, opts?: { timeout?: number }): Promise<string> {
    const args = [...buildSshFlags(this.cfg), buildDestination(this.cfg), command];
    const result = await this.execFn("ssh", args, {
      timeout: opts?.timeout ?? REMOTE_EXEC_DEFAULT_TIMEOUT_MS,
    });
    return result.stdout;
  }

  /** Copy a local file or directory to the remote host via scp. */
  public async copyTo(localPath: string, remotePath: string): Promise<void> {
    const flags = buildSshFlags(this.cfg);
    // scp uses -P (uppercase) instead of -p for port
    const scpFlags = flags.map((f, i) => (f === "-p" && i > 0 && flags[i - 1] !== "-o" ? "-P" : f));
    const args = ["-r", ...scpFlags, localPath, `${buildDestination(this.cfg)}:${remotePath}`];
    await this.execFn("scp", args, { timeout: REMOTE_COPY_TIMEOUT_MS });
  }
}

// ─── Tunnel ─────────────────────────────────────────────────

/** SSH tunnel that forwards a local port to the remote PowerLine port. */
class SshTunnel extends ProcessTunnel {
  private readonly cfg: SshEnvironmentConfig;

  public constructor(
    localPort: number,
    cfg: SshEnvironmentConfig,
    processFactory?: TunnelProcessFactory,
    portProbe?: TunnelPortProbe,
  ) {
    super(localPort, undefined, processFactory, portProbe);
    this.cfg = cfg;
  }

  /** Return the ssh command and arguments for the tunnel process. */
  protected spawnArgs(): { command: string; args: string[] } {
    const flags = buildSshFlags(this.cfg);
    const args = [
      "-N",
      "-L",
      `${this.localPort}:127.0.0.1:${DEFAULT_POWERLINE_PORT}`,
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
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
class SshReverseTunnel extends ProcessReverseTunnel {
  private readonly cfg: SshEnvironmentConfig;

  public constructor(
    localPort: number,
    remotePort: number,
    cfg: SshEnvironmentConfig,
    sleepFn: (ms: number) => Promise<void>,
    processFactory?: TunnelProcessFactory,
    portProbe?: TunnelPortProbe,
  ) {
    super(localPort, remotePort, sleepFn, processFactory, portProbe);
    this.cfg = cfg;
  }

  /** Return the ssh command with -R for reverse port forwarding. */
  protected spawnArgs(): { command: string; args: string[] } {
    const flags = buildSshFlags(this.cfg);
    const args = [
      "-N",
      "-R",
      `${this.remotePort}:127.0.0.1:${this.localPort}`,
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      ...flags,
      buildDestination(this.cfg),
    ];
    return { command: "ssh", args };
  }
}

// ─── Adapter ────────────────────────────────────────────────

/** Environment adapter that provisions and manages remote environments via SSH. */
export class SshAdapter extends RemoteTunnelAdapter<SshEnvironmentConfig> {
  public type: string = "ssh";

  /** Validate and parse the raw config into typed SSH configuration. */
  protected resolveConfig(config: Record<string, unknown>): {
    config: SshEnvironmentConfig;
    meta: RemoteTunnelMeta;
  } {
    const cfg = config as unknown as SshEnvironmentConfig;
    if (!cfg.host) {
      throw new Error("SSH adapter requires a 'host' in the configuration");
    }
    return { config: cfg, meta: { displayTarget: cfg.host } };
  }

  /** Create an SSH executor for remote command execution. */
  protected createExecutor(cfg: SshEnvironmentConfig): RemoteExecutor {
    return new SshExecutor(cfg, this.execFn);
  }

  /** Create an SSH forward tunnel (local port → remote PowerLine). */
  protected createForwardTunnel(localPort: number, cfg: SshEnvironmentConfig): ProcessTunnel {
    return new SshTunnel(localPort, cfg);
  }

  /** Create an SSH reverse tunnel (remote → local MCP). */
  protected createReverseTunnel(
    localPort: number,
    remotePort: number,
    cfg: SshEnvironmentConfig,
  ): ProcessTunnel {
    return new SshReverseTunnel(localPort, remotePort, cfg, this.sleepFn);
  }
}
