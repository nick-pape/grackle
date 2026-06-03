import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { AdapterLogger } from "./logger.js";
import { defaultLogger } from "./logger.js";
import { sleep } from "./utils.js";
import { waitForLocalPort } from "./connect.js";

/** Grace period before sending SIGKILL to a tunnel process. */
const TUNNEL_KILL_GRACE_MS: number = 1_000;

/** Abstraction over child-process spawning used by {@link ProcessTunnel}. */
export interface TunnelProcessFactory {
  /** Spawn a child process. */
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess;
}

/** Default implementation that delegates to Node's `child_process.spawn`. */
const NODE_TUNNEL_PROCESS_FACTORY: TunnelProcessFactory = { spawn };

/** Abstraction over port readiness probing used by {@link ProcessTunnel}. */
export interface TunnelPortProbe {
  /** Wait for a TCP port to accept connections on localhost. */
  waitForPort(port: number): Promise<void>;
}

/** Default implementation that polls with real TCP connections. */
const NODE_TUNNEL_PORT_PROBE: TunnelPortProbe = { waitForPort: waitForLocalPort };

/** Abstraction for a long-lived port-forwarding tunnel. */
export interface RemoteTunnel {
  /** The local port the tunnel is bound to. */
  localPort: number;
  /** Open the tunnel (spawns a background process). */
  open(): Promise<void>;
  /** Close the tunnel (kills the background process). */
  close(): Promise<void>;
  /** Return true if the tunnel process is still running. */
  isAlive(): boolean;
}

/**
 * Base class for tunnels backed by a long-lived child process.
 * Subclasses provide the command and arguments to spawn.
 */
export abstract class ProcessTunnel implements RemoteTunnel {
  public localPort: number;
  protected process: ChildProcess | undefined;
  protected logger: AdapterLogger;
  protected readonly processFactory: TunnelProcessFactory;
  protected readonly portProbe: TunnelPortProbe;
  /**
   * Optional environment variable overrides for the spawned tunnel process.
   * Merged on top of `process.env` when the tunnel is opened.
   */
  protected spawnEnv: NodeJS.ProcessEnv | undefined;

  public constructor(
    localPort: number,
    logger?: AdapterLogger,
    processFactory?: TunnelProcessFactory,
    portProbe?: TunnelPortProbe,
  ) {
    this.localPort = localPort;
    this.logger = logger ?? defaultLogger;
    this.processFactory = processFactory ?? NODE_TUNNEL_PROCESS_FACTORY;
    this.portProbe = portProbe ?? NODE_TUNNEL_PORT_PROBE;
  }

  /** Return the command and arguments to spawn the tunnel process. */
  protected abstract spawnArgs(): { command: string; args: string[] };

  /**
   * Wait for the tunnel to become ready after spawning.
   * Override in subclasses that can't probe a local port (e.g. reverse tunnels).
   */
  protected async waitForReady(): Promise<void> {
    await this.portProbe.waitForPort(this.localPort);
  }

  /** Open the tunnel by spawning the background process. */
  public async open(): Promise<void> {
    const { command, args } = this.spawnArgs();
    this.logger.info({ command, args }, "Opening tunnel");

    const env: NodeJS.ProcessEnv = this.spawnEnv
      ? { ...process.env, ...this.spawnEnv }
      : process.env;

    this.process = this.processFactory.spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      detached: false,
      env,
    });

    this.process.on("error", (err) => {
      this.logger.error({ err }, "Tunnel process error");
    });

    // Capture stderr so early-exit errors (e.g. port conflicts) propagate
    // with enough detail for isPortConflictError to match.
    const stderrChunks: string[] = [];
    this.process.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrChunks.push(text);
      this.logger.debug({ stderr: text }, "Tunnel stderr");
    });

    // Race the readiness probe against early process exit so port-conflict
    // errors from SSH/gh surface immediately instead of timing out.
    const earlyExit = new Promise<never>((_resolve, reject) => {
      this.process!.on("close", (code) => {
        const stderr = stderrChunks.join("").trim();
        reject(new Error(`Tunnel process exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
      });
    });
    // Prevent unhandled rejection if the process exits after open() succeeds.
    earlyExit.catch(() => {});

    try {
      await Promise.race([this.waitForReady(), earlyExit]);
    } catch (err) {
      await this.close();
      throw err;
    }
  }

  /** Close the tunnel by killing the background process. */
  public async close(): Promise<void> {
    if (this.process?.exitCode !== null) {
      return;
    }
    this.process.kill("SIGTERM");
    await sleep(TUNNEL_KILL_GRACE_MS);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- exitCode may change after SIGTERM + sleep
    if (this.process.exitCode === null) {
      this.process.kill("SIGKILL");
    }
    this.process = undefined;
  }

  /** Return true if the tunnel process is still running. */
  public isAlive(): boolean {
    return this.process?.exitCode === null;
  }
}
