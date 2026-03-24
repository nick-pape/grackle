import { startLocalPowerLine, type LocalPowerLineHandle, type ProcessFactory, type PortProbe } from "./local-powerline.js";
import type { EnvironmentStatus } from "@grackle-ai/common";
import { logger as parentLogger } from "@grackle-ai/core";

// eslint-disable-next-line @rushstack/typedef-var
const logger = parentLogger.child({ component: "powerline-manager" });

/** Maximum number of restarts allowed within the restart window before giving up. */
const DEFAULT_MAX_RESTARTS: number = 3;

/** Time window (ms) for counting restarts — resets after this period of stability. */
const DEFAULT_RESTART_WINDOW_MS: number = 60_000;

/** Options for constructing a {@link LocalPowerLineManager}. */
export interface LocalPowerLineManagerOptions {
  /** Port the PowerLine should listen on. */
  port: number;
  /** Host the PowerLine should bind to. */
  host: string;
  /** Authentication token the PowerLine should require. */
  token: string;
  /** Maximum restarts allowed within the restart window. */
  maxRestarts?: number;
  /** Time window (ms) for counting restarts. */
  restartWindowMs?: number;
  /** Called when the environment status should change (e.g. "disconnected", "error"). */
  onStatusChange?: (status: EnvironmentStatus) => void;
  /** Called after a successful restart (e.g. to clear auto-reconnect state). */
  onRestarted?: () => void;
  /** @internal Override child-process spawning (for testing). */
  processFactory?: ProcessFactory;
  /** @internal Override TCP port probing (for testing). */
  portProbe?: PortProbe;
  /** @internal Override PowerLine entry-point resolution (for testing). */
  resolveEntryPoint?: () => string;
}

/**
 * Manages the lifecycle of the local PowerLine child process, including
 * automatic restart on unexpected exit with circuit-breaker protection.
 */
export class LocalPowerLineManager {
  private handle: LocalPowerLineHandle | undefined;
  private stoppingGracefully: boolean = false;
  private restarting: boolean = false;
  private restartPending: boolean = false;
  private restartPromise: Promise<void> | undefined;
  private readonly restartTimestamps: number[] = [];
  private readonly options: Required<Pick<LocalPowerLineManagerOptions, "port" | "host" | "token" | "maxRestarts" | "restartWindowMs">>
    & Pick<LocalPowerLineManagerOptions, "onStatusChange" | "onRestarted" | "processFactory" | "portProbe" | "resolveEntryPoint">;

  public constructor(options: LocalPowerLineManagerOptions) {
    this.options = {
      ...options,
      maxRestarts: options.maxRestarts ?? DEFAULT_MAX_RESTARTS,
      restartWindowMs: options.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS,
    };
  }

  /**
   * Start the local PowerLine child process for the first time.
   * Throws if the process fails to start or accept connections.
   */
  public async start(): Promise<void> {
    this.stoppingGracefully = false;
    this.restartPending = false;
    this.handle = await this.spawnProcess();
    logger.info({ port: this.options.port, pid: this.handle.process.pid }, "Local PowerLine started");
  }

  /**
   * Gracefully stop the local PowerLine child process.
   * Prevents the onExit handler from triggering a restart.
   */
  public async stop(): Promise<void> {
    this.stoppingGracefully = true;
    this.restartPending = false;

    // Wait for any in-flight restart to finish so we can stop the new handle
    if (this.restartPromise) {
      await this.restartPromise;
    }

    const currentHandle: LocalPowerLineHandle | undefined = this.handle;
    if (currentHandle) {
      this.handle = undefined;
      await currentHandle.stop();
    }
  }

  /** Return the current process handle, or undefined if not running. */
  public getHandle(): LocalPowerLineHandle | undefined {
    return this.handle;
  }

  /** Spawn a new PowerLine process with the onExit handler wired up. */
  private async spawnProcess(): Promise<LocalPowerLineHandle> {
    const { port, host, token, processFactory, portProbe, resolveEntryPoint } = this.options;

    return startLocalPowerLine({
      port,
      host,
      token,
      onExit: (code, signal) => {
        this.onExit(code, signal);
      },
      ...(processFactory ? { processFactory } : {}),
      ...(portProbe ? { portProbe } : {}),
      ...(resolveEntryPoint ? { resolveEntryPoint } : {}),
    });
  }

  /** Handle unexpected PowerLine exit: mark disconnected, attempt restart. */
  private onExit(code: number | undefined, signal: string | undefined): void {
    if (this.stoppingGracefully) {
      return;
    }

    logger.error({ code, signal }, "Local PowerLine exited unexpectedly");
    this.handle = undefined;
    this.options.onStatusChange?.("disconnected");

    // If a restart is already in progress, mark a pending restart so it retries
    // after the current attempt finishes. Otherwise, start a new restart.
    if (this.restarting) {
      this.restartPending = true;
    } else {
      this.scheduleRestart();
    }
  }

  /** Fire-and-forget wrapper that stores the restart promise for stop() to await. */
  private scheduleRestart(): void {
    this.restartPromise = this.restart().catch((err) => {
      logger.error({ err }, "Unhandled error during PowerLine restart");
    });
  }

  /** Attempt to restart the PowerLine process with circuit-breaker protection. */
  private async restart(): Promise<void> {
    if (this.stoppingGracefully || this.restarting) {
      return;
    }
    this.restarting = true;

    try {
      const now: number = Date.now();
      const { maxRestarts, restartWindowMs } = this.options;

      // Prune timestamps outside the window
      while (this.restartTimestamps.length > 0 && this.restartTimestamps[0] < now - restartWindowMs) {
        this.restartTimestamps.shift();
      }

      // Circuit breaker: too many restarts in the window
      if (this.restartTimestamps.length >= maxRestarts) {
        logger.error(
          { restarts: this.restartTimestamps.length, windowMs: restartWindowMs },
          "Local PowerLine crash loop detected — giving up after %d restarts in %ds",
          maxRestarts,
          restartWindowMs / 1000,
        );
        this.options.onStatusChange?.("error");
        return;
      }

      this.restartTimestamps.push(now);
      logger.info("Restarting local PowerLine...");

      this.handle = await this.spawnProcess();

      // If stop() was called while we were spawning, leave handle set — stop()
      // awaits this promise and will clean up the handle afterwards.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- stoppingGracefully may flip during async spawnProcess
      if (this.stoppingGracefully) {
        return;
      }

      logger.info({ port: this.options.port, pid: this.handle.process.pid }, "Local PowerLine restarted successfully");
      this.options.onRestarted?.();

    } catch (err) {
      logger.error({ err, port: this.options.port }, "Failed to restart local PowerLine");
      this.handle = undefined;
      this.options.onStatusChange?.("error");
    } finally {
      this.restarting = false;
      this.restartPromise = undefined;

      // If another exit occurred while this restart was in progress, retry
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- stoppingGracefully may flip during async restart
      if (this.restartPending && !this.stoppingGracefully) {
        this.restartPending = false;
        this.scheduleRestart();
      }
    }
  }
}
