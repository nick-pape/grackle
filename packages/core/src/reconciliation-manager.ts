/**
 * ReconciliationManager — periodic ticker that runs ordered phases on each tick.
 *
 * Generalized from CronManager to support pluggable phases (cron, dispatch,
 * stall detection, etc.) in a single background loop.
 */

import { logger } from "./logger.js";

/** Default tick interval in milliseconds. */
const DEFAULT_TICK_INTERVAL_MS: number = 10_000;

/** A named async phase that runs during each reconciliation tick. */
export interface ReconciliationPhase {
  /** Short name for logging (e.g. "cron", "dispatch"). */
  name: string;
  /** Execute the phase. Errors are caught by the manager — they don't abort the tick. */
  execute: () => Promise<void>;
}

/**
 * Periodic reconciliation manager that runs ordered phases on a configurable interval.
 */
export class ReconciliationManager {
  private readonly phases: ReconciliationPhase[];
  private readonly tickIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking: boolean = false;
  private tickPromise: Promise<void> | undefined;

  /**
   * @param phases - Ordered list of phases to run on each tick
   * @param tickIntervalMs - Override tick interval (default: GRACKLE_RECONCILIATION_TICK_MS env var or 10s)
   */
  public constructor(phases: ReconciliationPhase[], tickIntervalMs?: number) {
    this.phases = phases;

    if (tickIntervalMs !== undefined) {
      this.tickIntervalMs = tickIntervalMs;
    } else {
      const envRaw = process.env.GRACKLE_RECONCILIATION_TICK_MS;
      if (envRaw !== undefined && envRaw !== "") {
        const parsed = parseInt(envRaw, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          this.tickIntervalMs = parsed;
        } else {
          logger.warn(
            { envValue: envRaw, default: DEFAULT_TICK_INTERVAL_MS },
            "Invalid GRACKLE_RECONCILIATION_TICK_MS; falling back to default",
          );
          this.tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
        }
      } else {
        this.tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
      }
    }
  }

  /** Start the periodic ticker. */
  public start(): void {
    if (this.timer) {
      return;
    }
    logger.info(
      { intervalMs: this.tickIntervalMs, phases: this.phases.map((p) => p.name) },
      "ReconciliationManager started",
    );
    this.timer = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.tryTick();
    }, this.tickIntervalMs);
    this.timer.unref();
  }

  /** Stop the ticker and await any in-flight tick. */
  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.tickPromise) {
      await this.tickPromise;
    }
    logger.info("ReconciliationManager stopped");
  }

  /** Attempt a tick, skipping if a previous tick is still in-flight. */
  private async tryTick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    this.tickPromise = this.tick();
    try {
      await this.tickPromise;
    } catch (err) {
      logger.error({ err }, "ReconciliationManager tick failed");
    } finally {
      this.ticking = false;
      this.tickPromise = undefined;
    }
  }

  /** Execute one tick: run each phase sequentially, isolating errors. */
  private async tick(): Promise<void> {
    for (const phase of this.phases) {
      try {
        await phase.execute();
      } catch (err) {
        logger.error({ err, phase: phase.name }, "Reconciliation phase '%s' failed", phase.name);
      }
    }
  }
}
