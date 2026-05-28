import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WsCloseCode } from "./error-codes.js";
import { Heartbeat, type HeartbeatTarget } from "./heartbeat.js";

/** Stub target that records the heartbeat's calls and replays pongs on demand. */
class StubTarget implements HeartbeatTarget {
  public pings = 0;
  public closedWith: { code: number; reason: string } | undefined;
  private pongListener: (() => void) | undefined;

  public ping(): void {
    this.pings += 1;
  }

  public close(code: number, reason: string): void {
    this.closedWith = { code, reason };
  }

  public on(_event: "pong", listener: () => void): void {
    this.pongListener = listener;
  }

  /** Fire a pong, as if the peer responded. */
  public pong(): void {
    this.pongListener?.();
  }
}

describe("Heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings on the configured interval", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 5 });
    hb.start();
    // First tick: no prior ping, so just send one.
    vi.advanceTimersByTime(100);
    expect(target.pings).toBe(1);
    // If we pong before the next tick, missedPongs stays 0 and the next tick
    // sends another ping.
    target.pong();
    vi.advanceTimersByTime(100);
    expect(target.pings).toBe(2);
    expect(target.closedWith).toBeUndefined();
  });

  it("does not count the initial tick as a missed pong", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 1 });
    hb.start();
    // First tick fires a ping, never a close — even with limit=1, there's
    // no prior ping to have missed.
    vi.advanceTimersByTime(100);
    expect(target.pings).toBe(1);
    expect(target.closedWith).toBeUndefined();
  });

  it("closes with 4001 after `missedLimit` consecutive un-pong'd pings", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 2 });
    hb.start();
    // Tick 1: send ping. pingOutstanding=true.
    vi.advanceTimersByTime(100);
    // Tick 2: still pingOutstanding (no pong). missedPongs=1 < 2 → send ping.
    vi.advanceTimersByTime(100);
    expect(target.closedWith).toBeUndefined();
    // Tick 3: still pingOutstanding. missedPongs=2 >= 2 → close.
    vi.advanceTimersByTime(100);
    expect(target.closedWith).toEqual({
      code: WsCloseCode.HeartbeatTimeout,
      reason: "heartbeat timeout",
    });
  });

  it("closes on the first real missed pong when missedLimit=1", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 1 });
    hb.start();
    vi.advanceTimersByTime(100); // ping #1, no close
    expect(target.closedWith).toBeUndefined();
    vi.advanceTimersByTime(100); // missedPongs=1 >= 1 → close
    expect(target.closedWith).toEqual({
      code: WsCloseCode.HeartbeatTimeout,
      reason: "heartbeat timeout",
    });
  });

  it("default missedLimit=2 closes on the 2nd real missed pong (regression for off-by-one)", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 2 });
    hb.start();
    vi.advanceTimersByTime(100); // ping #1
    vi.advanceTimersByTime(100); // 1st miss, ping #2
    expect(target.closedWith).toBeUndefined();
    vi.advanceTimersByTime(100); // 2nd miss → close
    expect(target.closedWith?.code).toBe(WsCloseCode.HeartbeatTimeout);
  });

  it("pong resets the miss counter", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 2 });
    hb.start();
    vi.advanceTimersByTime(100); // ping #1
    vi.advanceTimersByTime(100); // miss #1, ping #2
    target.pong(); // resets
    vi.advanceTimersByTime(100); // pingOutstanding=false at tick start → no miss, ping #3
    vi.advanceTimersByTime(100); // miss #1 again (against ping #3)
    expect(target.closedWith).toBeUndefined();
    vi.advanceTimersByTime(100); // miss #2 → close
    expect(target.closedWith?.code).toBe(WsCloseCode.HeartbeatTimeout);
  });

  it("stop() halts subsequent ticks", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 5 });
    hb.start();
    vi.advanceTimersByTime(100);
    expect(target.pings).toBe(1);
    hb.stop();
    vi.advanceTimersByTime(1_000);
    expect(target.pings).toBe(1);
  });

  it("stop() does not close the target itself", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 2 });
    hb.start();
    hb.stop();
    expect(target.closedWith).toBeUndefined();
  });

  it("start() is idempotent (does not double-schedule)", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 5 });
    hb.start();
    hb.start();
    hb.start();
    vi.advanceTimersByTime(100);
    expect(target.pings).toBe(1);
  });

  it("start() after stop() is a no-op", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 5 });
    hb.start();
    hb.stop();
    hb.start(); // should not restart
    vi.advanceTimersByTime(1_000);
    expect(target.pings).toBe(0);
  });

  it("stop() is idempotent", () => {
    const target = new StubTarget();
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 5 });
    hb.start();
    hb.stop();
    expect(() => hb.stop()).not.toThrow();
  });

  it("swallows a synchronous throw from target.ping()", () => {
    const target = new StubTarget();
    target.ping = () => {
      throw new Error("socket gone");
    };
    const hb = new Heartbeat({ target, intervalMs: 100, missedLimit: 5 });
    hb.start();
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    expect(target.closedWith).toBeUndefined();
  });
});
