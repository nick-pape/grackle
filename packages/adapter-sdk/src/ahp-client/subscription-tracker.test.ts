import { describe, expect, it } from "vitest";

import { AsyncQueue } from "./async-queue.js";
import { SubscriptionTracker } from "./subscription-tracker.js";
import type { SubscriptionMessage } from "./types.js";

const CHANNEL_A = "ahp-session:/a";
const CHANNEL_B = "ahp-session:/b";

describe("SubscriptionTracker", () => {
  it("starts with no channels", () => {
    const tracker = new SubscriptionTracker();
    expect(tracker.activeChannels()).toEqual([]);
    expect(tracker.has(CHANNEL_A)).toBe(false);
    expect(tracker.lastSeq(CHANNEL_A)).toBe(0);
    expect(tracker.maxAppliedServerSeq()).toBe(0);
  });

  it("ensure returns true on first call and false on subsequent calls", () => {
    const tracker = new SubscriptionTracker();
    expect(tracker.ensure(CHANNEL_A)).toBe(true);
    expect(tracker.ensure(CHANNEL_A)).toBe(false);
    expect(tracker.has(CHANNEL_A)).toBe(true);
    expect(tracker.activeChannels()).toEqual([CHANNEL_A]);
  });

  it("recordApplied advances monotonically", () => {
    const tracker = new SubscriptionTracker();
    tracker.ensure(CHANNEL_A);
    tracker.recordApplied(CHANNEL_A, 5);
    tracker.recordApplied(CHANNEL_A, 3);
    expect(tracker.lastSeq(CHANNEL_A)).toBe(5);
    tracker.recordApplied(CHANNEL_A, 6);
    expect(tracker.lastSeq(CHANNEL_A)).toBe(6);
  });

  it("recordApplied is a no-op for unknown channels", () => {
    const tracker = new SubscriptionTracker();
    tracker.recordApplied(CHANNEL_A, 5);
    expect(tracker.lastSeq(CHANNEL_A)).toBe(0);
  });

  it("shouldApply gates by per-channel lastServerSeq", () => {
    const tracker = new SubscriptionTracker();
    tracker.ensure(CHANNEL_A);
    tracker.recordApplied(CHANNEL_A, 5);
    expect(tracker.shouldApply(CHANNEL_A, 4)).toBe(false);
    expect(tracker.shouldApply(CHANNEL_A, 5)).toBe(false);
    expect(tracker.shouldApply(CHANNEL_A, 6)).toBe(true);
  });

  it("shouldApply returns false for unknown channels", () => {
    const tracker = new SubscriptionTracker();
    expect(tracker.shouldApply(CHANNEL_A, 1)).toBe(false);
  });

  it("reset overwrites lastServerSeq unconditionally", () => {
    const tracker = new SubscriptionTracker();
    tracker.ensure(CHANNEL_A);
    tracker.recordApplied(CHANNEL_A, 10);
    tracker.reset(CHANNEL_A, 3);
    expect(tracker.lastSeq(CHANNEL_A)).toBe(3);
    tracker.reset(CHANNEL_A, 0);
    expect(tracker.lastSeq(CHANNEL_A)).toBe(0);
  });

  it("reset is a no-op for unknown channels", () => {
    const tracker = new SubscriptionTracker();
    tracker.reset(CHANNEL_A, 5);
    expect(tracker.lastSeq(CHANNEL_A)).toBe(0);
  });

  it("maxAppliedServerSeq returns the per-host max across channels", () => {
    const tracker = new SubscriptionTracker();
    tracker.ensure(CHANNEL_A);
    tracker.ensure(CHANNEL_B);
    tracker.recordApplied(CHANNEL_A, 5);
    tracker.recordApplied(CHANNEL_B, 12);
    expect(tracker.maxAppliedServerSeq()).toBe(12);
    tracker.recordApplied(CHANNEL_A, 20);
    expect(tracker.maxAppliedServerSeq()).toBe(20);
  });

  it("addSubscriber/removeSubscriber round-trip; removeSubscriber returns true when last drops", () => {
    const tracker = new SubscriptionTracker();
    tracker.ensure(CHANNEL_A);
    const q1 = new AsyncQueue<SubscriptionMessage>();
    const q2 = new AsyncQueue<SubscriptionMessage>();
    tracker.addSubscriber(CHANNEL_A, q1);
    tracker.addSubscriber(CHANNEL_A, q2);
    expect(tracker.subscribers(CHANNEL_A).size).toBe(2);
    expect(tracker.removeSubscriber(CHANNEL_A, q1)).toBe(false);
    expect(tracker.subscribers(CHANNEL_A).size).toBe(1);
    expect(tracker.removeSubscriber(CHANNEL_A, q2)).toBe(true);
    expect(tracker.subscribers(CHANNEL_A).size).toBe(0);
  });

  it("addSubscriber throws when channel is not subscribed", () => {
    const tracker = new SubscriptionTracker();
    const q = new AsyncQueue<SubscriptionMessage>();
    expect(() => tracker.addSubscriber(CHANNEL_A, q)).toThrow(/not subscribed/);
  });

  it("removeSubscriber on unknown channel returns false", () => {
    const tracker = new SubscriptionTracker();
    const q = new AsyncQueue<SubscriptionMessage>();
    expect(tracker.removeSubscriber(CHANNEL_A, q)).toBe(false);
  });

  it("subscribers returns an empty set when channel is unknown", () => {
    const tracker = new SubscriptionTracker();
    expect(tracker.subscribers(CHANNEL_A).size).toBe(0);
  });

  it("drop removes the channel entry; shouldApply returns false afterwards", () => {
    const tracker = new SubscriptionTracker();
    tracker.ensure(CHANNEL_A);
    tracker.recordApplied(CHANNEL_A, 5);
    tracker.drop(CHANNEL_A);
    expect(tracker.has(CHANNEL_A)).toBe(false);
    expect(tracker.shouldApply(CHANNEL_A, 100)).toBe(false);
    expect(tracker.activeChannels()).toEqual([]);
  });

  it("re-ensure after drop resets lastServerSeq to 0", () => {
    const tracker = new SubscriptionTracker();
    tracker.ensure(CHANNEL_A);
    tracker.recordApplied(CHANNEL_A, 99);
    tracker.drop(CHANNEL_A);
    expect(tracker.ensure(CHANNEL_A)).toBe(true);
    expect(tracker.lastSeq(CHANNEL_A)).toBe(0);
  });

  it("clear removes every entry", () => {
    const tracker = new SubscriptionTracker();
    tracker.ensure(CHANNEL_A);
    tracker.ensure(CHANNEL_B);
    tracker.clear();
    expect(tracker.activeChannels()).toEqual([]);
  });
});
