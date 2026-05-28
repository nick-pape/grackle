/**
 * Heartbeat state machine. Sends WebSocket-level pings on a fixed interval
 * and closes the connection when too many pings go un-pong'd in a row.
 *
 * Extracted from {@link AhpServerSocket} so the close-on-threshold branch can
 * be tested deterministically with a stub target (real `ws` clients auto-pong
 * and make the close path unreachable in integration tests).
 */

import { WsCloseCode } from "./error-codes.js";

/** Minimal interface the heartbeat needs from its underlying socket. */
export interface HeartbeatTarget {
  /** Send a WebSocket-level PING frame. */
  ping(): void;
  /** Close the connection with the given code and reason. */
  close(code: number, reason: string): void;
  /** Subscribe to PONG events. The heartbeat only listens for "pong". */
  on(event: "pong", listener: () => void): void;
}

/** Construction options for {@link Heartbeat}. */
export interface HeartbeatOptions {
  /** Target socket the heartbeat operates on. */
  readonly target: HeartbeatTarget;
  /** Interval between ping ticks in milliseconds. */
  readonly intervalMs: number;
  /**
   * Number of consecutive missed pongs (i.e., ticks where the previous tick's
   * ping never got a pong before this tick) before closing with 4001.
   *
   * - `1` closes on the first real missed pong.
   * - `2` (default in `AhpServerSocket`) closes on the second.
   */
  readonly missedLimit: number;
  /**
   * Injectable timer factory for testing. Defaults to global
   * `setInterval`/`clearInterval`. Tests use `vi.useFakeTimers()` to bypass
   * real time without needing to inject anything here.
   */
  readonly timers?: {
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
  };
}

/**
 * Heartbeat for a single WebSocket-like target. Owns no `WebSocket` itself;
 * the integration with `ws.WebSocket` happens in {@link AhpServerSocket} via
 * the {@link HeartbeatTarget} adapter.
 */
export class Heartbeat {
  private readonly target: HeartbeatTarget;
  private readonly intervalMs: number;
  private readonly missedLimit: number;
  private readonly setInterval: typeof setInterval;
  private readonly clearInterval: typeof clearInterval;

  private timer: NodeJS.Timeout | undefined;
  /** True between a `ping()` and the matching `pong` event. */
  private pingOutstanding = false;
  /** Count of consecutive ticks where the previous tick's ping went un-pong'd. */
  private missedPongs = 0;
  /** True once `stop()` has been called; prevents the timer body from running. */
  private stopped = false;

  public constructor(opts: HeartbeatOptions) {
    this.target = opts.target;
    this.intervalMs = opts.intervalMs;
    this.missedLimit = opts.missedLimit;
    this.setInterval = opts.timers?.setInterval ?? setInterval;
    this.clearInterval = opts.timers?.clearInterval ?? clearInterval;

    this.target.on("pong", () => {
      this.pingOutstanding = false;
      this.missedPongs = 0;
    });
  }

  /** Begin pinging on the configured interval. Idempotent. */
  public start(): void {
    if (this.timer !== undefined || this.stopped) {
      return;
    }
    this.timer = this.setInterval(() => this.onTick(), this.intervalMs);
  }

  /** Stop pinging. After this, the heartbeat will not fire again. Idempotent. */
  public stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) {
      this.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private onTick(): void {
    if (this.stopped) {
      return;
    }
    // If the prior tick's ping never got a pong before this tick, count it
    // as a real miss. The initial tick (pingOutstanding=false) skips this
    // — there's no prior ping to have missed.
    if (this.pingOutstanding) {
      this.missedPongs += 1;
      if (this.missedPongs >= this.missedLimit) {
        this.stop();
        this.target.close(WsCloseCode.HeartbeatTimeout, "heartbeat timeout");
        return;
      }
    }
    try {
      this.target.ping();
      this.pingOutstanding = true;
    } catch {
      // Target already closing; the AhpServerSocket close handler will tear
      // down the timer via stop().
    }
  }
}
